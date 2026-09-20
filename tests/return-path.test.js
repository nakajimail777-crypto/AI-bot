import test from 'node:test';
import assert from 'node:assert/strict';
import { isReturnPathCandidate, returnPathInstruction, returnPathMessage, returnPathReset } from '../lib/return-path.js';

test('return path is a one-turn prompt with an opt-in marker', () => {
  assert.match(returnPathInstruction(true), /今回の返答だけ：戻れる逃げ道/);
  assert.match(returnPathInstruction(true), /質問は最大一つ/);
  assert.equal(returnPathInstruction(false), '');
  const marked = returnPathMessage('今日はもういいや', true);
  assert.match(marked, /［戻れる逃げ道］/);
  assert.match(returnPathReset([{ role: 'user', content: marked }], false), /現在はOFF/);
  assert.equal(returnPathReset([{ role: 'user', content: marked }], true), '');
});

test('future suggestion candidate needs two direct signals and never activates a mode itself', () => {
  assert.equal(isReturnPathCandidate('今日はもういいや。また今度にします。'), true);
  assert.equal(isReturnPathCandidate('今日はもういいや。'), false);
  assert.equal(isReturnPathCandidate('今日はもういいや。', [{ role: 'user', content: '失敗したくないです。' }]), true);
});
