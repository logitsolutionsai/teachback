import math
import unittest

from encoder_layer import attention, encoder_layer, feed_forward, layer_norm, multi_head_attention, softmax_rows
from fixture_params import PARAMS, X

A = math.exp(1 / math.sqrt(2)) / (math.exp(1 / math.sqrt(2)) + 1)  # softmax([1/sqrt(2), 0])[0]
B = 1 - A
I2 = [[1.0, 0.0], [0.0, 1.0]]
I4 = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]
FIRST_TWO = [[1.0, 0.0], [0.0, 1.0], [0.0, 0.0], [0.0, 0.0]]
LAST_TWO = [[0.0, 0.0], [0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]


def zeros(r, c):
    return [[0.0] * c for _ in range(r)]


class TestPieces(unittest.TestCase):
    def assertMatrixAlmostEqual(self, got, want, places=6):
        self.assertEqual(len(got), len(want), "wrong number of rows")
        for rg, rw in zip(got, want):
            self.assertEqual(len(rg), len(rw), "wrong number of columns")
            for g, w in zip(rg, rw):
                self.assertAlmostEqual(g, w, places=places)

    def test_softmax_rows(self):
        self.assertMatrixAlmostEqual(softmax_rows([[0.0, math.log(3.0)], [5.0, 5.0]]), [[0.25, 0.75], [0.5, 0.5]])

    def test_attention_hand_computed(self):
        out = attention([[1.0, 0.0]], [[1.0, 0.0], [0.0, 1.0]], [[1.0, 2.0], [3.0, 4.0]])
        self.assertMatrixAlmostEqual(out, [[A + 3 * B, 2 * A + 4 * B]])

    def test_multi_head_attention_hand_computed(self):
        p = {"WQ": [FIRST_TWO, LAST_TWO], "WK": [FIRST_TWO, LAST_TWO], "WV": [FIRST_TWO, LAST_TWO], "WO": I4}
        out = multi_head_attention([[1.0, 0.0, 0.0, 1.0], [0.0, 1.0, 1.0, 0.0]], p)
        self.assertMatrixAlmostEqual(out, [[A, B, B, A], [B, A, A, B]])

    def test_layer_norm_hand_computed(self):
        # Mean 2.5, population variance 1.25.
        sd = math.sqrt(1.25 + 1e-6)
        self.assertMatrixAlmostEqual(layer_norm([[1.0, 2.0, 3.0, 4.0]]), [[-1.5 / sd, -0.5 / sd, 0.5 / sd, 1.5 / sd]])

    def test_layer_norm_works_row_by_row(self):
        out = layer_norm([[1.0, 2.0, 3.0, 4.0], [10.0, 10.0, 10.0, 14.0]])
        sd2 = math.sqrt(3.0 + 1e-6)
        self.assertMatrixAlmostEqual(out[1:], [[-1 / sd2, -1 / sd2, -1 / sd2, 3 / sd2]])

    def test_feed_forward_relu(self):
        self.assertMatrixAlmostEqual(feed_forward([[1.0, -1.0]], I2, [0.0, 0.0], I2, [0.0, 0.0]), [[1.0, 0.0]])

    def test_feed_forward_bias_and_inner_width(self):
        # Here d_model = 2 and d_ff = 4; the paper uses d_model = 512 and d_ff = 2048.
        W1 = [[1.0, 0.0, -1.0, 0.0], [0.0, 1.0, 0.0, -1.0]]
        b1 = [0.0, 0.0, 0.0, 0.5]
        W2 = [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 1.0]]
        b2 = [0.5, -0.5]
        # x W1 + b1 = [2, 3, -2, -2.5]; ReLU -> [2, 3, 0, 0]; times W2 -> [2, 3]; plus b2 -> [2.5, 2.5].
        self.assertMatrixAlmostEqual(feed_forward([[2.0, 3.0]], W1, b1, W2, b2), [[2.5, 2.5]])


class TestEncoderLayer(unittest.TestCase):
    def assertMatrixAlmostEqual(self, got, want, places=6):
        self.assertEqual(len(got), len(want), "wrong number of rows")
        for rg, rw in zip(got, want):
            self.assertEqual(len(rg), len(rw), "wrong number of columns")
            for g, w in zip(rg, rw):
                self.assertAlmostEqual(g, w, places=places)

    def test_shape_is_kept(self):
        out = encoder_layer(X, PARAMS)
        self.assertEqual((len(out), len(out[0])), (3, 4))

    def test_zero_weights_leave_only_the_residual_path(self):
        # With W_O = 0 and an all-zero FFN, both sub-layers output 0, so the layer is LayerNorm(LayerNorm(X)).
        p = dict(PARAMS, WO=zeros(4, 4), W1=zeros(4, 8), b1=[0.0] * 8, W2=zeros(8, 4), b2=[0.0] * 4)
        self.assertMatrixAlmostEqual(encoder_layer(X, p), layer_norm(X), places=5)

    def test_every_output_row_is_normalised(self):
        for row in encoder_layer(X, PARAMS):
            mean = sum(row) / len(row)
            var = sum((x - mean) ** 2 for x in row) / len(row)
            self.assertAlmostEqual(mean, 0.0, places=6)
            self.assertAlmostEqual(var, 1.0, places=4)

    def test_order_of_inputs_only_reorders_outputs(self):
        # No positional encoding inside the layer: swapping two input rows swaps the output rows.
        # This is why the paper adds positional encodings before the first layer.
        swapped = [X[2], X[1], X[0]]
        a = encoder_layer(X, PARAMS)
        b = encoder_layer(swapped, PARAMS)
        self.assertMatrixAlmostEqual([b[2], b[1], b[0]], a)

    def test_full_forward_pass(self):
        want = [
            [1.128462462, -1.124269077, 0.853058294, -0.857251679],
            [-1.167707811, 1.396599416, -0.688801961, 0.459910355],
            [0.693606343, 0.678262566, -1.714976437, 0.343107528],
        ]
        self.assertMatrixAlmostEqual(encoder_layer(X, PARAMS), want, places=6)


if __name__ == "__main__":
    unittest.main()
