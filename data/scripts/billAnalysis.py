import json

with open('../data.json') as f:
    data = json.load(f)

def get_bill(bill, account_name):
    # account_name, bill_name, cost_per_month
    bill = []

checking_accounts = []
for account in data['accounts']:
    account_name = account['name']
    if account["type"] == "Checking":
        checking_accounts.append(account_name)
    bills = [get_bill(bill, account_name) for bill in account['bills']]
