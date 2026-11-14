import math
import unittest

from attention import attention, attention_weights

# Two numbers that come up again and again: softmax([1/sqrt(2), 0]).
A = math.exp(1 / math.sqrt(2)) / (math.exp(1 / math.sqrt(2)) + 1)  # about 0.66976
B = 1 - A  # about 0.33024


class TestScaledDotProductAttention(unittest.TestCase):
    def assertMatrixAlmostEqual(self, got, want, places=6):
        self.assertEqual(len(got), len(want), "wrong number of rows")
        for rg, rw in zip(got, want):
            self.assertEqual(len(rg), len(rw), "wrong number of columns")
            for g, w in zip(rg, rw):
                self.assertAlmostEqual(g, w, places=places)

    def test_hand_computed_example(self):
        # Scores are [1, 0] / sqrt(2); weights are [A, B]; output is A*V[0] + B*V[1].
        Q = [[1.0, 0.0]]
        K = [[1.0, 0.0], [0.0, 1.0]]
        V = [[1.0, 2.0], [3.0, 4.0]]
        out, w = attention(Q, K, V)
        self.assertMatrixAlmostEqual(w, [[A, B]])
        self.assertMatrixAlmostEqual(out, [[A * 1 + B * 3, A * 2 + B * 4]])

    def test_scores_are_divided_by_sqrt_dk(self):
        # d_k = 4, so the raw score 4 becomes 4 / 2 = 2. Without scaling the weight would be about 0.982.
        Q = [[2.0, 0.0, 0.0, 0.0]]
        K = [[2.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0]]
        w = attention_weights(Q, K)
        e2 = math.exp(2.0)
        self.assertMatrixAlmostEqual(w, [[e2 / (e2 + 1), 1 / (e2 + 1)]])

    def test_identical_keys_average_the_values(self):
        Q = [[1.0, 2.0]]
        K = [[3.0, 4.0], [3.0, 4.0]]
        V = [[2.0, 0.0], [0.0, 2.0]]
        out, w = attention(Q, K, V)
        self.assertMatrixAlmostEqual(w, [[0.5, 0.5]])
        self.assertMatrixAlmostEqual(out, [[1.0, 1.0]])

    def test_shapes(self):
        Q = [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]  # 3 queries
        K = [[1.0, 2.0], [2.0, 1.0]]  # 2 keys
        V = [[1.0, 0.0, 2.0], [0.0, 1.0, 2.0]]  # d_v = 3
        out, w = attention(Q, K, V)
        self.assertEqual((len(w), len(w[0])), (3, 2))
        self.assertEqual((len(out), len(out[0])), (3, 3))

    def test_each_row_of_weights_sums_to_one(self):
        Q = [[0.3, -1.2], [2.0, 0.5]]
        K = [[1.0, 0.0], [0.0, 1.0], [-1.0, 1.0]]
        for row in attention_weights(Q, K):
            self.assertAlmostEqual(sum(row), 1.0, places=9)


if __name__ == "__main__":
    unittest.main()
