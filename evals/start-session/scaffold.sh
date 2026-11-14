#!/usr/bin/env bash
# Day two: softmax and attention were learned yesterday, so their reviews are due today.
source "$(dirname "${BASH_SOURCE[0]//\//}")/../_shared/fixture.sh"
init_attention
AT="$(ago_hours 26)"
softmax_done
qkv_done
