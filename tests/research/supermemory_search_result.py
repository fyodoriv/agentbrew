import json


def matching_result_types(response, phrase):
    results = response.get("results", []) if isinstance(response, dict) else []
    if not isinstance(results, list):
        return set()
    target = phrase.lower()
    return {
        kind
        for item in results
        if isinstance(item, dict)
        for kind in ("memory", "chunk")
        if kind in item and target in json.dumps(item[kind], ensure_ascii=False).lower()
    }
