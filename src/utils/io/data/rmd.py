import json

with open("rmd.json", "r") as f:
    data = json.load(f)

print(data)
