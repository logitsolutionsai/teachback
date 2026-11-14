#!/usr/bin/env bash
# Today: softmax and attention mastered, scaled dot-product attention opened with
# one right answer. The planned item is sdpa-variance (numeric, answer 64).
source "$(dirname "${BASH_SOURCE[0]//\//}")/../_shared/fixture.sh"
init_attention
softmax_done
qkv_done
answer_item sdpa-formula B
