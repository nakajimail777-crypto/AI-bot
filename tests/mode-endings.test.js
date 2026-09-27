import test from 'node:test';
import assert from 'node:assert/strict';
import { skyGazingInstruction } from '../lib/chat-mode.js';
import { SELF_RETURN_RULES, fallbackReply, makeContext } from '../lib/self-return.js';

test('self return asks for a natural open ending without a question or forced experience', () => {
  assert.match(SELF_RETURN_RULES, /返答末尾の1〜2文/);
  assert.match(SELF_RETURN_RULES, /説明や結論で閉じ切らず/);
  assert.match(SELF_RETURN_RULES, /何も感じない、変化がない場合もそのままで成立/);
  assert.match(SELF_RETURN_RULES, /質問で終えない/);
});

test('self return fallbacks leave the next step open without asking anything', () => {
  for (const message of ['', 'AIに言われたから、そう思ってるだけかも', '肩が重い', 'もう考えたくない']) {
    const reply = fallbackReply(makeContext([], message));
    assert.doesNotMatch(reply, /[?？]/);
    assert.match(reply, /そのまま|今のまま|決めなくて大丈夫/);
  }
});

test('sky gazing allows nothing to happen and leaves a small open ending', () => {
  const instruction = skyGazingInstruction(true);
  assert.match(instruction, /返答末尾の1〜2文/);
  assert.match(instruction, /何かが浮かんでも浮かばなくても、何も起きなくても成立/);
  assert.match(instruction, /原則として質問で終わらせません/);
  assert.match(instruction, /大げさで詩的な表現を足しません/);
});
