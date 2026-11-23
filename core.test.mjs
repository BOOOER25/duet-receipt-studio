import test from 'node:test';
import assert from 'node:assert/strict';
import {example,totals,validate,normalize} from './core.js';
import {receiptTimeline,receiptFrame,receiptPrintSteps} from './receipt-timeline.js';
test('timeline totals include only revealed orders and preserve cents',()=>{
  const s=example('stickers');s.items=s.items.slice(0,3);
  assert.deepEqual(totals(s,0),[0,0]);
  assert.deepEqual(totals(s,4),[50.5,12]);
  s.items[0].amount='0.10';s.items[2].amount='0.20';
  assert.equal(totals(s,4)[0],.3);
});
test('reject invalid schedule, money, time and excessive side capacity',()=>{
  for(const change of [s=>s.items[0].at=99,s=>s.items[0].amount='-1',s=>s.items[0].clock='25:01',s=>s.items[0].amount='1.234']){
    const s=example('receipt');change(s);assert.throws(()=>validate(s));
  }
  const s=example('stickers');s.items=Array.from({length:19},(_,i)=>({...s.items[0],id:String(i),side:0}));assert.throws(()=>validate(s));
});
test('import removes remote references and rejects invalid schema',()=>{
  const s=example('receipt');s.people[0].avatar='https://tracking.example/a';s.extra='<script>';
  const clean=normalize(s);assert.equal(clean.people[0].avatar,'');assert.equal(clean.extra,undefined);
  assert.throws(()=>normalize({...s,version:2,duration:NaN}));
});
test('receipt shares hourly groups, orders by consumption time, and leaves absent sides empty',()=>{
  const s=example('receipt');
  s.items=[
    {...s.items[0],id:'late',side:0,clock:'19:00',at:0},
    {...s.items[1],id:'right',side:1,clock:'08:30',at:12},
    {...s.items[2],id:'left-b',side:0,clock:'08:45',at:1},
    {...s.items[3],id:'left-a',side:0,clock:'08:00',at:13},
  ];
  const timeline=receiptTimeline(s);
  assert.deepEqual(timeline.groups.map(g=>g.label),['8点','19点']);
  assert.deepEqual(timeline.groups[0].sides.map(items=>items.map(x=>x.id)),[['left-a','left-b'],['right']]);
  assert.deepEqual(timeline.groups[1].sides[1],[]);
  assert.ok(timeline.groups[1].top>=timeline.groups[0].bottom);
});
test('receipt printing and both totals ignore legacy independent animation offsets',()=>{
  const s=example('receipt'),other=structuredClone(s);
  other.items.forEach((item,i)=>item.at=s.duration-.5-i*.1);
  for(const time of [0,.5,2,5,10,s.duration]){
    const a=receiptFrame(s,time),b=receiptFrame(other,time);
    assert.equal(a.feed,b.feed);
    assert.deepEqual(a.totals,b.totals);
    assert.deepEqual(a.printed.map(g=>g.hour),b.printed.map(g=>g.hour));
  }
  const timeline=receiptTimeline(s);
  const firstDone=Array.from({length:171},(_,i)=>i/10).find(t=>receiptFrame(s,t,timeline).printed.length===1);
  const first=receiptFrame(s,firstDone,timeline);
  assert.deepEqual(first.totals,timeline.groups[0].sides.map(items=>items.reduce((sum,x)=>sum+Math.round(Number(x.amount)*100),0)/100));
  assert.deepEqual(receiptFrame(s,s.duration).totals,totals(s,s.duration));
});
test('paper never reverses and finishes empty, single-hour, and short multi-hour receipts',()=>{
  for(const variant of ['empty','one-hour','multiple']){
    const s=example('receipt');s.duration=3;
    if(variant==='empty')s.items=[];
    if(variant==='one-hour')s.items.forEach(x=>x.clock='12:00');
    let previous=0;
    for(let i=0;i<=300;i++){
      const current=receiptFrame(s,i/100);
      assert.ok(Number.isFinite(current.feed));
      assert.ok(current.feed>=previous);
      previous=current.feed;
    }
    assert.equal(receiptFrame(s,3).completed,true);
  }
});
test('each time block is pulled quickly and stays completely still before the next pull',()=>{
  const s=example('receipt'),timeline=receiptTimeline(s),steps=receiptPrintSteps(s.duration,timeline);
  for(let i=0;i<steps.length;i++){
    const step=steps[i],next=steps[i+1]?.start??s.duration;
    assert.ok(step.end-step.start<=.48+.000001);
    const moving=receiptFrame(s,(step.start+step.end)/2,timeline);
    assert.equal(moving.printing,true);
    assert.ok(moving.feed>step.from&&moving.feed<step.to);
    const holdA=receiptFrame(s,step.end+(next-step.end)*.2,timeline);
    const holdB=receiptFrame(s,step.end+(next-step.end)*.8,timeline);
    assert.equal(holdA.printing,false);
    assert.equal(holdB.printing,false);
    assert.equal(holdA.feed,step.to);
    assert.equal(holdB.feed,step.to);
    assert.deepEqual(holdA.totals,holdB.totals);
    if(i>0&&i<=timeline.groups.length){
      assert.equal(holdA.printed.length,i);
      assert.deepEqual(holdA.totals,timeline.groups.slice(0,i).reduce((sum,group)=>sum.map((n,side)=>n+group.sides[side].reduce((v,item)=>v+Math.round(Number(item.amount)*100),0)),[0,0]).map(n=>n/100));
    }
  }
  assert.equal(receiptFrame(s,0).feed,0);
  assert.equal(receiptFrame(s,s.duration-1).completed,true);
});
test('dense three-second receipts retain a stationary interval for every pull',()=>{
  const s=example('receipt');s.duration=3;
  s.items=Array.from({length:36},(_,i)=>({...s.items[i%8],id:String(i),side:i%2,at:0,clock:`${String(i%24).padStart(2,'0')}:00`}));
  const timeline=receiptTimeline(s),steps=receiptPrintSteps(s.duration,timeline);
  for(let i=0;i<steps.length;i++){
    const next=steps[i+1]?.start??s.duration;
    assert.ok(steps[i].start<steps[i].end&&steps[i].end<next);
    assert.equal(receiptFrame(s,(steps[i].end+next)/2,timeline).feed,steps[i].to);
  }
  assert.deepEqual(receiptFrame(s,3).totals,totals(s,3));
});
