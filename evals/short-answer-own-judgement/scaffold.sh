#!/usr/bin/env bash
# Today: softmax mastered, attention opened with one right answer. The planned
# item is qkv-roles (short answer).
source "$(dirname "${BASH_SOURCE[0]//\//}")/../_shared/fixture.sh"
init_attention
softmax_done
answer_item qkv-output B
