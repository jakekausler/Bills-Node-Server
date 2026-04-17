from yfinance import Ticker
import json

with open(
    f"{__file__}/../portfolio.json",
    "r",
) as f:
    portfolio = json.load(f)

data = {}
for symbol in portfolio.keys():
    data[symbol] = {
        "assets": {},
        "percentage": portfolio[symbol],
    }
    try:
        ticker = Ticker(symbol)
        asset_classes = ticker.get_funds_data().asset_classes
        for asset_class in asset_classes:
            data[symbol]["assets"][asset_class.replace("Position", "")] = asset_classes[
                asset_class
            ]
    except Exception as e:
        if symbol == "5021":
            data[symbol]["assets"] = {
                "cash": 0,
                "stock": 0,
                "bond": 1,
                "preferred": 0,
                "convertible": 0,
                "other": 0,
            }
        elif symbol == "5019":
            data[symbol]["assets"] = {
                "cash": 0,
                "stock": 1,
                "bond": 0,
                "preferred": 0,
                "convertible": 0,
                "other": 0,
            }
        else:
            print(e)

total_breakdown = {}
# Initialize total breakdown with all possible asset types
total_breakdown = {
    "cash": 0,
    "stock": 0,
    "bond": 0,
    "preferred": 0,
    "convertible": 0,
    "other": 0,
}

# For each symbol, multiply its asset percentages by its portfolio percentage
for symbol in data:
    symbol_percentage = data[symbol]["percentage"]
    for asset_type in data[symbol]["assets"]:
        asset_percentage = data[symbol]["assets"][asset_type]
        # print(symbol, asset_type, asset_percentage, symbol_percentage)
        total_breakdown[asset_type] += asset_percentage * symbol_percentage

data = {
    "total_breakdown": total_breakdown,
    "data": data,
}

with open(
    f"{__file__}/../portfolioAnalysis.json",
    "w",
) as f:
    json.dump(data, f, indent=4)
