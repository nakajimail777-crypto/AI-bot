import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMON_RESPONSE_GUIDANCE } from '../lib/common-response-guidance.js';
import { previewReply } from '../lib/preview-example-replies.js';

test('shared guidance connects five directions without changing modes', () => {
  for (const phrase of ['深める・広げる・戻る・進む・そのままでいる', '本人が明示した依頼・希望・拒否・訂正', '探索の質問は一回の返答につき最大一つ', '自動で切り替えない', '既存の専用仕様を優先']) {
    assert.match(COMMON_RESPONSE_GUIDANCE, new RegExp(phrase));
  }
});

test('local preview examples show the intended four response directions', () => {
  const cases = [
    ['AIに言われたからそう思っているだけかも', /私の言葉も提案.*保留/],
    ['別の見方を知りたい', /別の見方として.*小さく試して/],
    ['具体的に何をすればいい？', /まず.*5分だけ着手/],
    ['今日はもう考えたくない', /これ以上考えなくて大丈夫.*休みましょう/],
  ];
  for (const [message, expected] of cases) assert.match(previewReply(message), expected);
});
