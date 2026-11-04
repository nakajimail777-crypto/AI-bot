import test from 'node:test';
import assert from 'node:assert/strict';
import '../assets/ayumi.js';
const A=globalThis.DragonAyumi;
test('deadline badges show calendar days before, on and after the deadline',()=>{
 assert.equal(A.deadlineLabel('2026-11-09','2026-11-04'),'あと5日');
 assert.equal(A.deadlineLabel('2026-11-09','2026-11-09'),'今日が期限');
 assert.equal(A.deadlineLabel('2026-11-09','2026-11-10'),'期限から1日');
 assert.equal(A.deadlineLabel('2027-01-01','2026-12-31'),'あと1日');
 assert.equal(A.deadlineLabel('2028-03-01','2028-02-28'),'あと2日');
});
test('unset or invalid deadline produces no badge',()=>{
 for(const value of [null,undefined,'','2026-02-30','bad'])assert.equal(A.deadlineLabel(value,'2026-11-04'),'');
});
test('deadline changes at Tokyo midnight, not UTC midnight',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-08T14:59:59Z')});
 assert.equal(A.deadlineLabel('2026-11-09'),'あと1日');
 t.mock.timers.tick(1000);
 assert.equal(A.deadlineLabel('2026-11-09'),'今日が期限');
 t.mock.timers.tick(86400000);
 assert.equal(A.deadlineLabel('2026-11-09'),'期限から1日');
});
