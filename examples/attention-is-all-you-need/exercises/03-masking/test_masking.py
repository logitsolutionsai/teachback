import math
import unittest

from masking import causal_mask, masked_attention

NEG_INF = float("-inf")
A = math.exp(1 / math.sqrt(2)) / (math.exp(1 / math.sqrt(2)) + 1)  # softmax([1/sqrt(2), 0])[0]
B = 1 - A

X = [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]


class TestMasking(unittest.TestCase):
    def assertRowAlmostEqual(self, got, want, places=6):
        self.assertEqual(len(got), len(want))
        for g, w in zip(got, want):
            self.assertAlmostEqual(g, w, places=places)

    def test_mask_shape_and_values(self):
        self.assertEqual(causal_mask(3), [[0.0, NEG_INF, NEG_INF], [0.0, 0.0, NEG_INF], [0.0, 0.0, 0.0]])

    def test_mask_of_one(self):
        self.assertEqual(causal_mask(1), [[0.0]])

    def test_first_position_only_sees_itself(self):
        out, w = masked_attention(X, X, X, causal_mask(3))
        self.assertRowAlmostEqual(w[0], [1.0, 0.0, 0.0])
        self.assertRowAlmostEqual(out[0], X[0])

    def test_masked_weights_are_exactly_zero(self):
        _, w = masked_attention(X, X, X, causal_mask(3))
        for i in range(3):
            for j in range(i + 1, 3):
                self.assertEqual(w[i][j], 0.0)

    def test_second_position_hand_computed(self):
        # Query [0, 1] against keys [1, 0] and [0, 1]: scores 0 and 1/sqrt(2); key 3 is masked.
        _, w = masked_attention(X, X, X, causal_mask(3))
        self.assertRowAlmostEqual(w[1], [B, A, 0.0])

    def test_rows_still_sum_to_one(self):
        _, w = masked_attention(X, X, X, causal_mask(3))
        for row in w:
            self.assertAlmostEqual(sum(row), 1.0, places=9)

    def test_future_values_cannot_leak(self):
        V1 = [[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]]
        V2 = [[1.0, 2.0], [3.0, 4.0], [500.0, -600.0]]
        out1, _ = masked_attention(X, X, V1, causal_mask(3))
        out2, _ = masked_attention(X, X, V2, causal_mask(3))
        self.assertRowAlmostEqual(out1[0], out2[0])
        self.assertRowAlmostEqual(out1[1], out2[1])

    def test_zero_mask_is_plain_attention(self):
        # Query [1, 0] against keys [1, 0], [0, 1], [1, 1]: scores a, 0, a with a = 1/sqrt(2).
        zero = [[0.0] * 3 for _ in range(3)]
        _, w = masked_attention(X, X, X, zero)
        ea = math.exp(1 / math.sqrt(2))
        self.assertRowAlmostEqual(w[0], [ea / (2 * ea + 1), 1 / (2 * ea + 1), ea / (2 * ea + 1)])


if __name__ == "__main__":
    unittest.main()
