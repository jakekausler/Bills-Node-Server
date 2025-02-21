import csv

with open(
    "/home/jakekausler/programs/billsV2/server-node/src/utils/io/data/scripts/transaction_history_detail__02_20_2025.csv",
    "r",
) as f:
    reader = csv.reader(f)
    headers = next(reader)
    data = []
    for row in reader:
        data.append({headers[i]: value for i, value in enumerate(row)})

contributions = [d for d in data if d["CATEGORY"] == "CONTRIBUTION"]

# Group contributions by date and source name, summing the totals
activities = {}
for contribution in contributions:
    date = contribution["AS OF DATE"]
    source = contribution["SOURCE NAME 1"]
    total = round(float(contribution["SHARES"]) * float(contribution["PRICE"]), 2)

    key = (date, source)
    if key not in activities:
        activities[key] = 0
    activities[key] = round(activities[key] + total, 2)

# Convert to list of dictionaries if needed
activity_list = [
    {"date": date, "source": source, "total": total}
    for (date, source), total in activities.items()
]

# Sort by date
activity_list.sort(key=lambda x: x["date"])

# Format as activities
activity_list = [
    {
        "date": activity["date"],
        "dateIsVariable": False,
        "dateVariable": None,
        "name": activity["source"],
        "amount": activity["total"],
        "category": "Ignore.Other",
        "flag": False,
        "flagColor": None,
        "isTransfer": False,
        "from": None,
        "to": None,
        "amountIsVariable": False,
        "amountVariable": None,
    }
    for activity in activity_list
]

import json

with open("activity_list.json", "w") as f:
    f.write(json.dumps(activity_list, indent=2))
