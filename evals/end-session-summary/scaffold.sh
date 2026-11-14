#!/usr/bin/env bash
# A session in progress today: softmax mastered and its exercise passed, then
# one answer on attention. The learner is about to stop.
source "$(dirname "${BASH_SOURCE[0]//\//}")/../_shared/fixture.sh"
init_attention
softmax_done
answer_item qkv-output B
