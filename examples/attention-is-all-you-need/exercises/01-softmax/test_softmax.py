import math
import unittest

from softmax import softmax, softmax_rows


class TestSoftmax(unittest.TestCase):
    def assertListAlmostEqual(self, got, want, places=6):
        self.assertEqual(len(got), len(want), "wrong length")
        for g, w in zip(got, want):
            self.assertAlmostEqual(g, w, places=places)

    def test_equal_scores_give_equal_weights(self):
        self.assertListAlmostEqual(softmax([0.0, 0.0]), [0.5, 0.5])

    def test_hand_computed_values(self):
        # exp(0) = 1 and exp(ln 3) = 3, so the weights are 1/4 and 3/4.
        self.assertListAlmostEqual(softmax([0.0, math.log(3.0)]), [0.25, 0.75])

    def test_weights_sum_to_one(self):
        self.assertAlmostEqual(sum(softmax([1.0, 2.0, 3.0, -4.0])), 1.0, places=9)

    def test_order_is_kept(self):
        w = softmax([0.5, 2.0, -1.0])
        self.assertTrue(w[1] > w[0] > w[2])

    def test_adding_a_constant_changes_nothing(self):
        self.assertListAlmostEqual(softmax([1.0, 2.0, 3.0]), softmax([101.0, 102.0, 103.0]))

    def test_large_scores_do_not_overflow(self):
        e = math.e
        self.assertListAlmostEqual(softmax([1000.0, 1001.0]), [1 / (1 + e), e / (1 + e)])

    def test_minus_infinity_gets_zero_weight(self):
        self.assertEqual(softmax([0.0, float("-inf")]), [1.0, 0.0])

    def test_input_is_not_modified(self):
        scores = [3.0, 1.0]
        softmax(scores)
        self.assertEqual(scores, [3.0, 1.0])

    def test_rows(self):
        got = softmax_rows([[0.0, 0.0], [0.0, math.log(3.0)]])
        self.assertListAlmostEqual(got[0], [0.5, 0.5])
        self.assertListAlmostEqual(got[1], [0.25, 0.75])


if __name__ == "__main__":
    unittest.main()
