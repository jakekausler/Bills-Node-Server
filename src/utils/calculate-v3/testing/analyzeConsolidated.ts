import * as fs from 'fs';
import * as path from 'path';

interface ConsolidatedActivity {
  id: string;
  name: string;
  category: string;
  flag: boolean;
  flagColor: string | null;
  isTransfer: boolean;
  from: string | null;
  to: string | null;
  amount: number;
  amountIsVariable: boolean;
  amountVariable: string | null;
  date: string;
  dateIsVariable: boolean;
  dateVariable: string | null;
  balance: number;
  billId: string | null;
  firstBill: boolean;
  interestId: string | null;
  firstInterest: boolean;
}

interface AccountData {
  account: string;
  consolidatedActivity: ConsolidatedActivity[];
}

interface ResultFile {
  fileName: string;
  data: AccountData[];
}

interface ActivityKey {
  accountName: string;
  activityId: string;
  activityName: string;
  date: string;
}

interface ActivityAnomaly {
  type: 'missing' | 'amount_difference' | 'field_difference';
  activityKey: ActivityKey;
  filesWithActivity: string[];
  filesMissingActivity: string[];
  differences?: {
    field: string;
    values: { [fileName: string]: any };
  }[];
}

interface AccountAnomaly {
  type: 'missing_account' | 'activity_count_difference';
  accountName: string;
  filesWithAccount: string[];
  filesMissingAccount: string[];
  activityCounts?: { [fileName: string]: number };
}

interface AnalysisReport {
  totalFiles: number;
  accountAnomalies: AccountAnomaly[];
  activityAnomalies: ActivityAnomaly[];
  summary: {
    totalAccounts: Set<string>;
    totalUniqueActivities: number;
    filesWithMostAnomalies: string[];
    commonAnomalyPatterns: string[];
  };
}

class ConsolidatedActivityAnalyzer {
  private resultFiles: ResultFile[] = [];
  private readonly resultsDir = path.join(__dirname, 'consolidatedActivities');

  async loadAllResults(): Promise<void> {
    console.log('Loading all result files...');

    if (!fs.existsSync(this.resultsDir)) {
      throw new Error(`Results directory not found: ${this.resultsDir}`);
    }

    const files = fs
      .readdirSync(this.resultsDir)
      .filter((file) => file.endsWith('.json'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/(\d+)/)?.[1] || '0');
        return numA - numB;
      });

    console.log(`Found ${files.length} result files`);

    for (const file of files) {
      try {
        const filePath = path.join(this.resultsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content) as AccountData[];

        this.resultFiles.push({
          fileName: file,
          data: data,
        });

        console.log(`Loaded ${file}: ${data.length} accounts`);
      } catch (error) {
        console.error(`Error loading ${file}:`, error);
      }
    }
  }

  createActivityKey(accountName: string, activity: ConsolidatedActivity): ActivityKey {
    return {
      accountName,
      activityId: activity.id,
      activityName: activity.name,
      date: activity.date,
    };
  }

  findAccountAnomalies(): AccountAnomaly[] {
    const anomalies: AccountAnomaly[] = [];
    const allAccounts = new Set<string>();
    const accountFileMap = new Map<string, string[]>();

    // Build map of which files contain which accounts
    this.resultFiles.forEach((file) => {
      file.data.forEach((account) => {
        allAccounts.add(account.account);
        if (!accountFileMap.has(account.account)) {
          accountFileMap.set(account.account, []);
        }
        accountFileMap.get(account.account)!.push(file.fileName);
      });
    });

    // Find missing accounts
    for (const accountName of allAccounts) {
      const filesWithAccount = accountFileMap.get(accountName) || [];
      const filesMissingAccount = this.resultFiles
        .map((f) => f.fileName)
        .filter((fileName) => !filesWithAccount.includes(fileName));

      if (filesMissingAccount.length > 0) {
        anomalies.push({
          type: 'missing_account',
          accountName,
          filesWithAccount,
          filesMissingAccount,
        });
      }

      // Check for activity count differences
      const activityCounts: { [fileName: string]: number } = {};
      let hasCountDifferences = false;
      let baseCount: number | null = null;

      for (const file of this.resultFiles) {
        const account = file.data.find((acc) => acc.account === accountName);
        if (account) {
          const count = account.consolidatedActivity.length;
          activityCounts[file.fileName] = count;

          if (baseCount === null) {
            baseCount = count;
          } else if (baseCount !== count) {
            hasCountDifferences = true;
          }
        }
      }

      if (hasCountDifferences) {
        anomalies.push({
          type: 'activity_count_difference',
          accountName,
          filesWithAccount,
          filesMissingAccount: [],
          activityCounts,
        });
      }
    }

    return anomalies;
  }

  findActivityAnomalies(): ActivityAnomaly[] {
    const anomalies: ActivityAnomaly[] = [];
    const activityMap = new Map<string, Map<string, ConsolidatedActivity>>();

    // Build comprehensive activity map: activityKey -> fileName -> activity
    this.resultFiles.forEach((file) => {
      file.data.forEach((account) => {
        account.consolidatedActivity.forEach((activity) => {
          const key = `${account.account}|${activity.id}|${activity.name}|${activity.date}`;
          if (!activityMap.has(key)) {
            activityMap.set(key, new Map());
          }
          activityMap.get(key)!.set(file.fileName, activity);
        });
      });
    });

    // Analyze each unique activity
    for (const [keyString, fileActivityMap] of activityMap) {
      const [accountName, activityId, activityName, date] = keyString.split('|');
      const activityKey: ActivityKey = { accountName, activityId, activityName, date };

      const filesWithActivity = Array.from(fileActivityMap.keys());
      const filesMissingActivity = this.resultFiles
        .map((f) => f.fileName)
        .filter((fileName) => !filesWithActivity.includes(fileName));

      // Check for missing activities
      if (filesMissingActivity.length > 0) {
        anomalies.push({
          type: 'missing',
          activityKey,
          filesWithActivity,
          filesMissingActivity,
        });
      }

      // Check for field differences among files that have this activity
      if (filesWithActivity.length > 1) {
        const fieldDifferences: { field: string; values: { [fileName: string]: any } }[] = [];
        const activities = Array.from(fileActivityMap.values());
        const baseActivity = activities[0];

        const fieldsToCheck: (keyof ConsolidatedActivity)[] = [
          'amount',
          'balance',
          'category',
          'flag',
          'flagColor',
          'isTransfer',
          'from',
          'to',
          'amountIsVariable',
          'amountVariable',
          'dateIsVariable',
          'dateVariable',
          'billId',
          'firstBill',
          'interestId',
          'firstInterest',
        ];

        for (const field of fieldsToCheck) {
          const values: { [fileName: string]: any } = {};
          let hasDifference = false;

          for (const [fileName, activity] of fileActivityMap) {
            values[fileName] = activity[field];
            if (JSON.stringify(activity[field]) !== JSON.stringify(baseActivity[field])) {
              hasDifference = true;
            }
          }

          if (hasDifference) {
            fieldDifferences.push({ field, values });
          }
        }

        if (fieldDifferences.length > 0) {
          anomalies.push({
            type: 'field_difference',
            activityKey,
            filesWithActivity,
            filesMissingActivity: [],
            differences: fieldDifferences,
          });
        }
      }
    }

    return anomalies;
  }

  generateReport(): AnalysisReport {
    console.log('Generating analysis report...');

    const accountAnomalies = this.findAccountAnomalies();
    const activityAnomalies = this.findActivityAnomalies();

    const allAccounts = new Set<string>();
    this.resultFiles.forEach((file) => {
      file.data.forEach((account) => {
        allAccounts.add(account.account);
      });
    });

    const totalUniqueActivities = new Set<string>();
    this.resultFiles.forEach((file) => {
      file.data.forEach((account) => {
        account.consolidatedActivity.forEach((activity) => {
          totalUniqueActivities.add(`${account.account}|${activity.id}`);
        });
      });
    });

    // Find files with most anomalies
    const fileAnomalyCounts = new Map<string, number>();
    [...accountAnomalies, ...activityAnomalies].forEach((anomaly) => {
      if ('filesMissingAccount' in anomaly) {
        anomaly.filesMissingAccount.forEach((fileName) => {
          fileAnomalyCounts.set(fileName, (fileAnomalyCounts.get(fileName) || 0) + 1);
        });
      }
      if ('filesMissingActivity' in anomaly) {
        anomaly.filesMissingActivity.forEach((fileName) => {
          fileAnomalyCounts.set(fileName, (fileAnomalyCounts.get(fileName) || 0) + 1);
        });
      }
    });

    const filesWithMostAnomalies = Array.from(fileAnomalyCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([fileName]) => fileName);

    // Identify common anomaly patterns
    const commonPatterns: string[] = [];
    const amountDiffs = activityAnomalies.filter(
      (a) => a.type === 'field_difference' && a.differences?.some((d) => d.field === 'amount'),
    );
    if (amountDiffs.length > 0) {
      commonPatterns.push(`${amountDiffs.length} activities with amount differences`);
    }

    const balanceDiffs = activityAnomalies.filter(
      (a) => a.type === 'field_difference' && a.differences?.some((d) => d.field === 'balance'),
    );
    if (balanceDiffs.length > 0) {
      commonPatterns.push(`${balanceDiffs.length} activities with balance differences`);
    }

    const missingActivities = activityAnomalies.filter((a) => a.type === 'missing');
    if (missingActivities.length > 0) {
      commonPatterns.push(`${missingActivities.length} missing activities`);
    }

    return {
      totalFiles: this.resultFiles.length,
      accountAnomalies,
      activityAnomalies,
      summary: {
        totalAccounts: allAccounts,
        totalUniqueActivities: totalUniqueActivities.size,
        filesWithMostAnomalies,
        commonAnomalyPatterns: commonPatterns,
      },
    };
  }

  printReport(report: AnalysisReport): void {
    console.log('\n'.repeat(2));
    console.log('='.repeat(80));
    console.log('CONSOLIDATED ACTIVITY ANOMALY ANALYSIS REPORT');
    console.log('='.repeat(80));

    console.log(`\nSUMMARY:`);
    console.log(`- Total files analyzed: ${report.totalFiles}`);
    console.log(`- Total accounts found: ${report.summary.totalAccounts.size}`);
    console.log(`- Accounts: ${Array.from(report.summary.totalAccounts).join(', ')}`);
    console.log(`- Total unique activities: ${report.summary.totalUniqueActivities}`);
    console.log(`- Account anomalies found: ${report.accountAnomalies.length}`);
    console.log(`- Activity anomalies found: ${report.activityAnomalies.length}`);

    if (report.summary.filesWithMostAnomalies.length > 0) {
      console.log(`\nFILES WITH MOST ANOMALIES:`);
      report.summary.filesWithMostAnomalies.forEach((fileName) => {
        console.log(`- ${fileName}`);
      });
    }

    if (report.summary.commonAnomalyPatterns.length > 0) {
      console.log(`\nCOMMON ANOMALY PATTERNS:`);
      report.summary.commonAnomalyPatterns.forEach((pattern) => {
        console.log(`- ${pattern}`);
      });
    }

    console.log('\n' + '-'.repeat(80));
    console.log('ACCOUNT ANOMALIES');
    console.log('-'.repeat(80));

    if (report.accountAnomalies.length === 0) {
      console.log('No account anomalies found.');
    } else {
      report.accountAnomalies.forEach((anomaly, index) => {
        console.log(`\n${index + 1}. ${anomaly.type.toUpperCase()}: ${anomaly.accountName}`);

        if (anomaly.filesMissingAccount.length > 0) {
          console.log(`   Missing from: ${anomaly.filesMissingAccount.join(', ')}`);
        }

        if (anomaly.activityCounts) {
          console.log(`   Activity counts by file:`);
          Object.entries(anomaly.activityCounts)
            .sort((a, b) => b[1] - a[1])
            .forEach(([fileName, count]) => {
              console.log(`     ${fileName}: ${count} activities`);
            });
        }
      });
    }

    console.log('\n' + '-'.repeat(80));
    console.log('ACTIVITY ANOMALIES');
    console.log('-'.repeat(80));

    if (report.activityAnomalies.length === 0) {
      console.log('No activity anomalies found.');
    } else {
      // Group anomalies by type for better readability
      const missingActivities = report.activityAnomalies.filter((a) => a.type === 'missing');
      const amountDifferences = report.activityAnomalies.filter(
        (a) => a.type === 'field_difference' && a.differences?.some((d) => d.field === 'amount'),
      );
      const otherFieldDifferences = report.activityAnomalies.filter(
        (a) => a.type === 'field_difference' && !a.differences?.some((d) => d.field === 'amount'),
      );

      if (missingActivities.length > 0) {
        console.log(`\nMISSING ACTIVITIES (${missingActivities.length}):`);
        missingActivities.slice(0, 10).forEach((anomaly, index) => {
          console.log(`\n${index + 1}. ${anomaly.activityKey.accountName} - ${anomaly.activityKey.activityName}`);
          console.log(`   Date: ${anomaly.activityKey.date}`);
          console.log(`   Present in: ${anomaly.filesWithActivity.join(', ')}`);
          console.log(`   Missing from: ${anomaly.filesMissingActivity.join(', ')}`);
        });
        if (missingActivities.length > 10) {
          console.log(`   ... and ${missingActivities.length - 10} more missing activities.`);
        }
      }

      if (amountDifferences.length > 0) {
        console.log(`\nAMOUNT DIFFERENCES (${amountDifferences.length}):`);
        amountDifferences.slice(0, 10).forEach((anomaly, index) => {
          console.log(`\n${index + 1}. ${anomaly.activityKey.accountName} - ${anomaly.activityKey.activityName}`);
          console.log(`   Date: ${anomaly.activityKey.date}`);

          const amountDiff = anomaly.differences?.find((d) => d.field === 'amount');
          if (amountDiff) {
            console.log(`   Amount differences:`);
            Object.entries(amountDiff.values).forEach(([fileName, amount]) => {
              console.log(`     ${fileName}: ${amount}`);
            });
          }

          // Show other differences too
          const otherDiffs = anomaly.differences?.filter((d) => d.field !== 'amount');
          if (otherDiffs && otherDiffs.length > 0) {
            console.log(`   Other differences: ${otherDiffs.map((d) => d.field).join(', ')}`);
          }
        });
        if (amountDifferences.length > 10) {
          console.log(`   ... and ${amountDifferences.length - 10} more amount differences.`);
        }
      }

      if (otherFieldDifferences.length > 0) {
        console.log(`\nOTHER FIELD DIFFERENCES (${otherFieldDifferences.length}):`);
        otherFieldDifferences.slice(0, 5).forEach((anomaly, index) => {
          console.log(`\n${index + 1}. ${anomaly.activityKey.accountName} - ${anomaly.activityKey.activityName}`);
          console.log(`   Date: ${anomaly.activityKey.date}`);
          console.log(`   Differing fields: ${anomaly.differences?.map((d) => d.field).join(', ')}`);
        });
        if (otherFieldDifferences.length > 5) {
          console.log(`   ... and ${otherFieldDifferences.length - 5} more field differences.`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('END OF REPORT');
    console.log('='.repeat(80));
  }

  async saveReport(report: AnalysisReport, outputPath?: string): Promise<void> {
    const defaultPath = path.join(__dirname, 'anomaly-analysis-report.json');
    const savePath = outputPath || defaultPath;

    const reportData = {
      ...report,
      summary: {
        ...report.summary,
        totalAccounts: Array.from(report.summary.totalAccounts),
      },
      generatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(savePath, JSON.stringify(reportData, null, 2));
    console.log(`\nReport saved to: ${savePath}`);
  }

  async analyze(): Promise<AnalysisReport> {
    await this.loadAllResults();
    const report = this.generateReport();
    this.printReport(report);
    await this.saveReport(report);
    return report;
  }
}

// Export for use as a module
export { ConsolidatedActivityAnalyzer, AnalysisReport, ActivityAnomaly, AccountAnomaly };

// Main execution when run directly
if (require.main === module) {
  async function main() {
    try {
      const analyzer = new ConsolidatedActivityAnalyzer();
      await analyzer.analyze();
    } catch (error) {
      console.error('Analysis failed:', error);
      process.exit(1);
    }
  }

  main();
}
