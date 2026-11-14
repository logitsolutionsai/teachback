#!/usr/bin/env bash
# Today: scaled dot-product attention is close to mastery (the variance item was
# missed once, then answered right later), so the plan is its teach-back item,
# sdpa-teachback.
source "$(dirname "${BASH_SOURCE[0]//\//}")/../_shared/fixture.sh"
init_attention
softmax_done
qkv_done
answer_item sdpa-formula B
judge_item sdpa-variance wrong
answer_item sdpa-variance 64
