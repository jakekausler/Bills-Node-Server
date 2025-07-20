import { readFileSync } from 'fs';

function analyzeExtraActivities() {
  console.log('🔍 Extra Activities Analysis');
  console.log('============================');

  try {
    // Load calculated and original data
    const calculatedData = JSON.parse(readFileSync('./calculated-activities/current_to_near_future.json', 'utf8'));
    const originalData = JSON.parse(readFileSync('./original-responses/current_to_near_future.json', 'utf8'));

    console.log(`✅ Loaded calculated data: ${calculatedData.length} accounts`);
    console.log(`✅ Loaded original data: ${originalData.length} accounts`);

    const startDate = new Date('2025-07-19');
    const endDate = new Date('2025-08-19');

    // Analyze Kendall account
    console.log(`\n🔍 Looking for Kendall account...`);
    const kendallCalculated = calculatedData.find((acc: any) => acc.name === 'Kendall');
    const kendallOriginal = originalData.find((acc: any) => acc.name === 'Kendall' || acc.accountName === 'Kendall');

    console.log(`Kendall calculated found: ${!!kendallCalculated}`);
    console.log(`Kendall original found: ${!!kendallOriginal}`);

    // Debug the account names
    console.log(
      `\nCalculated account names:`,
      calculatedData.map((acc: any) => acc.name),
    );
    console.log(
      `\nOriginal account names:`,
      originalData.map((acc: any) => acc.name || acc.accountName),
    );

    if (kendallCalculated && kendallOriginal) {
      console.log(`\n📊 KENDALL ACCOUNT:`);
      console.log(`   Original activities: ${kendallOriginal.consolidatedActivity.length}`);
      console.log(`   Calculate-v2 activities: ${kendallCalculated.consolidatedActivity.length}`);
      console.log(
        `   Extra activities: +${kendallCalculated.consolidatedActivity.length - kendallOriginal.consolidatedActivity.length}`,
      );

      // Create signature sets for comparison
      const originalSignatures = new Set(
        kendallOriginal.consolidatedActivity.map((act: any) => `${act.name}|${act.date}|${act.amount}`),
      );

      // Find extra activities
      const extraActivities = kendallCalculated.consolidatedActivity.filter((activity: any) => {
        const signature = `${activity.name}|${activity.date}|${activity.amount}`;
        return !originalSignatures.has(signature);
      });

      console.log(`\n🔍 Extra Activities in Kendall (${extraActivities.length} total):`);
      extraActivities
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .forEach((activity: any, index: number) => {
          const actDate = new Date(activity.date);
          const inRange = actDate >= startDate && actDate <= endDate;
          const dateStatus = inRange ? '✅' : '❌';

          console.log(`   ${index + 1}. [${dateStatus}] ${activity.name} - $${activity.amount} (${activity.date})`);
          if (activity.isTransfer) {
            console.log(`      Transfer: ${activity.fro || activity.from} → ${activity.to}`);
          }
          if (activity.billId) {
            console.log(`      Bill ID: ${activity.billId}${activity.firstBill ? ', First Bill: true' : ''}`);
          }
        });

      // Count activities by date range
      const extraBeforeRange = extraActivities.filter((a: any) => new Date(a.date) < startDate);
      const extraInRange = extraActivities.filter((a: any) => {
        const d = new Date(a.date);
        return d >= startDate && d <= endDate;
      });
      const extraAfterRange = extraActivities.filter((a: any) => new Date(a.date) > endDate);

      console.log(`\n📈 Extra Activities by Date Range:`);
      console.log(`   Before range (< 2025-07-19): ${extraBeforeRange.length}`);
      console.log(`   In range (2025-07-19 to 2025-08-19): ${extraInRange.length}`);
      console.log(`   After range (> 2025-08-19): ${extraAfterRange.length}`);
    }

    // Analyze Jake account
    const jakeCalculated = calculatedData.find((acc: any) => acc.name === 'Jake');
    const jakeOriginal = originalData.find((acc: any) => acc.name === 'Jake' || acc.accountName === 'Jake');

    if (jakeCalculated && jakeOriginal) {
      console.log(`\n\n📊 JAKE ACCOUNT:`);
      console.log(`   Original activities: ${jakeOriginal.consolidatedActivity.length}`);
      console.log(`   Calculate-v2 activities: ${jakeCalculated.consolidatedActivity.length}`);
      console.log(
        `   Extra activities: +${jakeCalculated.consolidatedActivity.length - jakeOriginal.consolidatedActivity.length}`,
      );

      // Create signature sets for comparison
      const originalSignatures = new Set(
        jakeOriginal.consolidatedActivity.map((act: any) => `${act.name}|${act.date}|${act.amount}`),
      );

      // Find extra activities
      const extraActivities = jakeCalculated.consolidatedActivity.filter((activity: any) => {
        const signature = `${activity.name}|${activity.date}|${activity.amount}`;
        return !originalSignatures.has(signature);
      });

      console.log(`\n🔍 First 15 Extra Activities in Jake (${extraActivities.length} total):`);
      extraActivities
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 15)
        .forEach((activity: any, index: number) => {
          const actDate = new Date(activity.date);
          const inRange = actDate >= startDate && actDate <= endDate;
          const dateStatus = inRange ? '✅' : '❌';

          console.log(`   ${index + 1}. [${dateStatus}] ${activity.name} - $${activity.amount} (${activity.date})`);
          if (activity.isTransfer) {
            console.log(`      Transfer: ${activity.fro || activity.from} → ${activity.to}`);
          }
          if (activity.billId) {
            console.log(`      Bill ID: ${activity.billId}${activity.firstBill ? ', First Bill: true' : ''}`);
          }
        });

      if (extraActivities.length > 15) {
        console.log(`   ... and ${extraActivities.length - 15} more activities`);
      }

      // Count activities by date range for Jake
      const extraBeforeRange = extraActivities.filter((a: any) => new Date(a.date) < startDate);
      const extraInRange = extraActivities.filter((a: any) => {
        const d = new Date(a.date);
        return d >= startDate && d <= endDate;
      });
      const extraAfterRange = extraActivities.filter((a: any) => new Date(a.date) > endDate);

      console.log(`\n📈 Jake Extra Activities by Date Range:`);
      console.log(`   Before range (< 2025-07-19): ${extraBeforeRange.length}`);
      console.log(`   In range (2025-07-19 to 2025-08-19): ${extraInRange.length}`);
      console.log(`   After range (> 2025-08-19): ${extraAfterRange.length}`);
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

analyzeExtraActivities();
