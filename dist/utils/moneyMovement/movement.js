/**
 * Calculates money movement across all accounts for the specified date range
 * @param accountsAndTransfers - The complete financial data structure
 * @param startDate - Start date for the movement calculation
 * @param endDate - End date for the movement calculation
 * @returns Movement data organized by year and account
 */
export function getMoneyMovement(accountsAndTransfers, startDate, endDate) {
    const movement = {};
    for (let i = startDate.getUTCFullYear(); i <= endDate.getUTCFullYear(); i++) {
        movement[i] = {};
        accountsAndTransfers.accounts.forEach((account) => {
            movement[i][account.name] = 0;
        });
    }
    accountsAndTransfers.accounts.forEach((account) => {
        account.consolidatedActivity.forEach((activity) => {
            if (activity.date.getUTCFullYear() in movement) {
                movement[activity.date.getUTCFullYear()][account.name] += activity.amount;
            }
        });
    });
    return movement;
}
/**
 * Converts movement data into chart-ready format for visualization
 * @param movement - Raw movement data organized by year and account
 * @returns Chart data with labels and datasets for each account
 */
export function getMoneyMovementChartData(movement) {
    const labels = Object.keys(movement).map((year) => year.toString());
    const datasets = Object.keys(movement[parseInt(Object.keys(movement)[0])]).map((accountName) => {
        return {
            label: accountName,
            data: Object.keys(movement).map((year) => movement[parseInt(year)][accountName]),
        };
    });
    return {
        labels,
        datasets,
    };
}
