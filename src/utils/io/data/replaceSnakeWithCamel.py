import json

FILE = "/home/jakekausler/programs/billsV2/server-node/src/utils/io/data/refinance.json"

with open(FILE, "r") as f:
    data = json.load(f)


def snake_to_camel(snake_str):
    components = snake_str.split("_")
    return components[0] + "".join(x.title() for x in components[1:])


def convert_keys(obj):
    if isinstance(obj, dict):
        new_dict = {}
        for key, value in obj.items():
            new_key = snake_to_camel(key)
            new_dict[new_key] = convert_keys(value)
        return new_dict
    elif isinstance(obj, list):
        return [convert_keys(item) for item in obj]
    else:
        return obj


data = convert_keys(data)

with open(FILE, "w") as f:
    json.dump(data, f, indent=4)
