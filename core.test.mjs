import test from 'node:test';
import assert from 'node:assert/strict';
import {example,totals,validate,normalize,localDate,calendarDay} from './core.js';
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
test('new backgrounds persist and old preset drafts adopt fish without changing custom backgrounds',()=>{
  const fresh=example('receipt');
  assert.equal(fresh.theme,'fish');
  assert.equal(normalize(fresh).theme,'fish');
  for(const theme of ['fish','paws','pink','mint','lilac']){
    assert.equal(normalize({...fresh,theme}).theme,theme);
  }
  const old={...fresh,theme:'lilac'};delete old.presetRevision;
  assert.equal(normalize(old).theme,'fish');
  const custom=normalize({...old,background:'my-background'});
  assert.equal(custom.background,'my-background');
  assert.equal(custom.theme,'lilac');
  assert.equal(normalize({...fresh,theme:'paws',background:'my-background'}).background,'my-background');
});
test('receipt shares date groups, sorts within a day, and leaves absent sides empty',()=>{
  const s=example('receipt');
  s.items=[
    {...s.items[0],id:'late',side:0,date:'2026-11-24',clock:'07:00',at:0},
    {...s.items[1],id:'right',side:1,date:'2026-11-23',clock:'08:30',at:12},
    {...s.items[2],id:'left-b',side:0,date:'2026-11-23',clock:'18:45',at:1},
    {...s.items[3],id:'left-a',side:0,date:'2026-11-23',clock:'08:00',at:13},
  ];
  const timeline=receiptTimeline(s);
  assert.deepEqual(timeline.groups.map(g=>g.label),['周一','周二']);
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
    assert.deepEqual(a.printed.map(g=>g.date),b.printed.map(g=>g.date));
  }
  const timeline=receiptTimeline(s);
  const firstDone=Array.from({length:171},(_,i)=>i/10).find(t=>receiptFrame(s,t,timeline).printed.length===1);
  const first=receiptFrame(s,firstDone,timeline);
  assert.deepEqual(first.totals,timeline.groups[0].sides.map(items=>items.reduce((sum,x)=>sum+Math.round(Number(x.amount)*100),0)/100));
  assert.deepEqual(receiptFrame(s,s.duration).totals,totals(s,s.duration));
});
test('paper never reverses and finishes empty, single-day, and short multi-day receipts',()=>{
  for(const variant of ['empty','one-day','multiple']){
    const s=example('receipt');s.duration=3;
    if(variant==='empty')s.items=[];
    if(variant==='one-day')s.items.forEach(x=>x.date='2026-11-23');
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
  s.items=Array.from({length:36},(_,i)=>({...s.items[i%8],id:String(i),side:i%2,at:0,date:localDate(new Date(2026,10,1+i)),clock:`${String(i%24).padStart(2,'0')}:00`}));
  const timeline=receiptTimeline(s),steps=receiptPrintSteps(s.duration,timeline);
  for(let i=0;i<steps.length;i++){
    const next=steps[i+1]?.start??s.duration;
    assert.ok(steps[i].start<steps[i].end&&steps[i].end<next);
    assert.equal(receiptFrame(s,(steps[i].end+next)/2,timeline).feed,steps[i].to);
  }
  assert.deepEqual(receiptFrame(s,3).totals,totals(s,3));
});
const onDates=dates=>{
  const s=example('receipt');
  s.items=dates.map((date,i)=>({...s.items[i%s.items.length],id:`date-${i}`,side:i%2,date,at:0}));
  return s;
};
test('one calendar day restores central hour markers and aligns both sides by hour',()=>{
  const s=example('receipt');
  s.items=[
    {...s.items[0],id:'last',side:0,date:'2026-11-24',clock:'23:59',at:0},
    {...s.items[1],id:'right',side:1,date:'2026-11-24',clock:'12:30',at:12},
    {...s.items[2],id:'left-b',side:0,date:'2026-11-24',clock:'12:45',at:1},
    {...s.items[3],id:'left-a',side:0,date:'2026-11-24',clock:'12:00',at:13},
    {...s.items[4],id:'first',side:1,date:'2026-11-24',clock:'00:00',at:0},
    {...s.items[5],id:'next',side:1,date:'2026-11-24',clock:'13:00',at:0},
  ];
  const t=receiptTimeline(s);
  assert.equal(t.dateMode,'hour');
  assert.equal(t.span,1);
  assert.deepEqual(t.groups.map(g=>g.label),['0点','12点','13点','23点']);
  assert.deepEqual(t.groups[1].sides.map(items=>items.map(x=>x.id)),[['left-a','left-b'],['right']]);
  assert.deepEqual(t.groups[2].sides[0],[]);
  const steps=receiptPrintSteps(s.duration,t);
  for(let i=0;i<t.groups.length;i++){
    const printed=receiptFrame(s,steps[i+1].end,t,steps);
    assert.equal(printed.printed.length,i+1);
    assert.deepEqual(printed.totals,t.groups.slice(0,i+1).reduce((sum,g)=>sum.map((n,side)=>n+g.sides[side].reduce((v,item)=>v+Math.round(Number(item.amount)*100),0)),[0,0]).map(n=>n/100));
  }
  assert.deepEqual(receiptFrame(s,s.duration).totals,totals(s,s.duration));
});
test('crossing midnight uses weekday markers even when elapsed time is under 24 hours',()=>{
  const s=onDates(['2026-11-24','2026-11-25']);
  s.items[0].clock='23:59';s.items[1].clock='00:01';
  const t=receiptTimeline(s);
  assert.equal(t.dateMode,'weekday');
  assert.deepEqual(t.groups.map(g=>g.label),['周二','周三']);
  assert.equal(receiptTimeline(onDates(['2026-11-24'])).groups[0].label,'8点');
  assert.deepEqual(receiptTimeline(onDates([])).groups,[]);
});
test('seven inclusive dates use weekdays, including a week or month boundary',()=>{
  for(const dates of [
    ['2026-11-23','2026-11-29'],
    ['2026-11-27','2026-12-03'],
    ['2026-12-29','2027-01-04'],
  ]){
    const t=receiptTimeline(onDates(dates));
    assert.equal(t.dateMode,'weekday');
    assert.equal(t.span,7);
    assert.ok(t.groups.every(g=>/^周[一二三四五六日]$/.test(g.label)));
  }
  assert.deepEqual(receiptTimeline(onDates(['2026-11-23','2026-11-29'])).groups.map(g=>g.label),['周一','周日']);
});
test('eight days or an entire month display day numbers',()=>{
  for(const [dates,labels] of [
    [['2026-11-23','2026-11-30'],['23号','30号']],
    [['2026-10-01','2026-10-02','2026-10-31'],['1号','2号','31号']],
  ]){
    const t=receiptTimeline(onDates(dates));
    assert.equal(t.dateMode,'day');
    assert.deepEqual(t.groups.map(g=>g.label),labels);
  }
});
test('month and year boundaries retain day labels without merging equal day numbers',()=>{
  const s=onDates(['2027-01-01','2026-11-01','2026-12-31','2026-12-01']);
  const t=receiptTimeline(s);
  assert.equal(t.dateMode,'day');
  assert.deepEqual(t.groups.map(g=>g.date),['2026-11-01','2026-12-01','2026-12-31','2027-01-01']);
  assert.deepEqual(t.groups.map(g=>g.label),['1号','1号','31号','1号']);
  assert.deepEqual(receiptFrame(s,s.duration).totals,totals(s,s.duration));
});
test('dates validate real calendar days and inclusive ranges across leap day',()=>{
  assert.notEqual(calendarDay('2028-02-29'),null);
  for(const date of ['2026-02-29','2026-04-31','2026-11-00','2026-13-01','24','',null]){
    assert.equal(calendarDay(date),null);
    assert.throws(()=>validate(onDates([date])));
  }
  const t=receiptTimeline(onDates(['2028-02-27','2028-03-04']));
  assert.equal(t.span,7);
  assert.equal(t.dateMode,'weekday');
});
test('legacy drafts acquire one local date and preserve images, times, amounts and other settings',()=>{
  const old=example('receipt');
  old.background='custom-bg';
  for(const item of old.items)delete item.date;
  const migrated=normalize(old);
  assert.ok(migrated.items.every(item=>item.date===localDate()));
  const withoutDate=structuredClone(migrated);
  for(const item of withoutDate.items)delete item.date;
  assert.deepEqual(withoutDate,old);
  assert.deepEqual(normalize(migrated),migrated);
  assert.equal(receiptTimeline(migrated).dateMode,'hour');
});
