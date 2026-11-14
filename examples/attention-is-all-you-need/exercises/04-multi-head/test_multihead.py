import math
import unittest

from attention import attention
from multihead import concat_heads, multi_head_attention

A = math.exp(1 / math.sqrt(2)) / (math.exp(1 / math.sqrt(2)) + 1)  # softmax([1/sqrt(2), 0])[0]
B = 1 - A

# d_model = 4 split into h = 2 heads of d_k = d_v = 2.
FIRST_TWO = [[1.0, 0.0], [0.0, 1.0], [0.0, 0.0], [0.0, 0.0]]
LAST_TWO = [[0.0, 0.0], [0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]
I4 = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]
X = [[1.0, 0.0, 0.0, 1.0], [0.0, 1.0, 1.0, 0.0]]


def params(wo=I4):
    return {"WQ": [FIRST_TWO, LAST_TWO], "WK": [FIRST_TWO, LAST_TWO], "WV": [FIRST_TWO, LAST_TWO], "WO": wo}


class TestMultiHead(unittest.TestCase):
    def assertMatrixAlmostEqual(self, got, want, places=6):
        self.assertEqual(len(got), len(want), "wrong number of rows")
        for rg, rw in zip(got, want):
            self.assertEqual(len(rg), len(rw), "wrong number of columns")
            for g, w in zip(rg, rw):
                self.assertAlmostEqual(g, w, places=places)

    def test_concat_heads(self):
        self.assertEqual(concat_heads([[[1, 2]], [[3, 4]]]), [[1, 2, 3, 4]])
        self.assertEqual(concat_heads([[[1], [2]], [[3], [4]], [[5], [6]]]), [[1, 3, 5], [2, 4, 6]])

    def test_output_shape_is_n_by_d_model(self):
        out = multi_head_attention(X, X, params())
        self.assertEqual((len(out), len(out[0])), (2, 4))

    def test_two_heads_hand_computed(self):
        # Head 1 sees the first two coordinates, head 2 the last two; W_O is the identity.
        # Head 1, row 0: query [1, 0], keys [1, 0] and [0, 1] -> weights [A, B] -> [A, B].
        # Head 2, row 0: query [0, 1], keys [0, 1] and [1, 0] -> weights [A, B] -> A*[0, 1] + B*[1, 0].
        out = multi_head_attention(X, X, params())
        self.assertMatrixAlmostEqual(out, [[A, B, B, A], [B, A, A, B]])

    def test_output_projection_is_applied(self):
        doubled = [[2.0 * x for x in row] for row in I4]
        out = multi_head_attention(X, X, params(doubled))
        self.assertMatrixAlmostEqual(out, [[2 * A, 2 * B, 2 * B, 2 * A], [2 * B, 2 * A, 2 * A, 2 * B]])

    def test_one_head_is_plain_attention(self):
        I2 = [[1.0, 0.0], [0.0, 1.0]]
        Y = [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]
        p = {"WQ": [I2], "WK": [I2], "WV": [I2], "WO": I2}
        want, _ = attention(Y, Y, Y)
        self.assertMatrixAlmostEqual(multi_head_attention(Y, Y, p), want)

    def test_queries_and_memory_can_differ(self):
        # Encoder-decoder attention: one query row, three memory rows.
        memory = [[1.0, 0.0, 0.0, 1.0], [0.0, 1.0, 1.0, 0.0], [1.0, 1.0, 1.0, 1.0]]
        out = multi_head_attention([[1.0, 0.0, 0.0, 1.0]], memory, params())
        self.assertEqual((len(out), len(out[0])), (1, 4))


if __name__ == "__main__":
    unittest.main()
