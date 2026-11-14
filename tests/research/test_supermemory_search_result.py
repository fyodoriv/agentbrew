import unittest

from supermemory_search_result import matching_result_types


class SearchResultEvidenceTest(unittest.TestCase):
    def test_query_echo_is_not_recall(self):
        response = {"query": "violet otter", "results": []}
        self.assertEqual(matching_result_types(response, "violet otter"), set())

    def test_distinguishes_memory_and_source_chunk(self):
        response = {"results": [{"memory": "violet otter rule"}, {"chunk": "violet otter source"}]}
        self.assertEqual(matching_result_types(response, "violet otter"), {"memory", "chunk"})


if __name__ == "__main__":
    unittest.main()
