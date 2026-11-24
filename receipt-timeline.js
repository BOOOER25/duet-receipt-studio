import {clamp,cents,calendarDay,compareOrders,localDate} from './core.js';

export const HEADER_HEIGHT=104;
const ROW_HEIGHT=94, GROUP_GAP=18, SUMMARY_HEIGHT=166;

// Use UTC calendar-day numbers so DST and local timezone changes cannot
// alter the inclusive date range or merge matching days in different months.
export function receiptTimeline(state) {
  const fallbackDate=localDate();
  const days=state.items.map(item=>calendarDay(item.date||fallbackDate));
  const span=days.length?Math.max(...days)-Math.min(...days)+1:0;
  const dateMode=span<=1?'hour':span<=7?'weekday':'day';
  const byPeriod=new Map();
  for(const item of state.items) {
    const date=item.date||fallbackDate,day=calendarDay(date);
    const hour=Number(item.clock.slice(0,2)),key=dateMode==='hour'?`${date}-${hour}`:date;
    const weekday=['周日','周一','周二','周三','周四','周五','周六'][((day+4)%7+7)%7];
    if(!byPeriod.has(key))byPeriod.set(key,{
      date,hour:dateMode==='hour'?hour:null,
      label:dateMode==='hour'?`${hour}点`:dateMode==='weekday'?weekday:`${Number(date.slice(8))}号`,
      sides:[[],[]],
    });
    byPeriod.get(key).sides[item.side].push(item);
  }
  let y=HEADER_HEIGHT;
  const groups=[...byPeriod.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.hour-b.hour).map(group=>{
    for(const items of group.sides)items.sort(compareOrders);
    const top=y,rows=Math.max(...group.sides.map(items=>items.length),1);
    y+=rows*ROW_HEIGHT+GROUP_GAP;
    return {...group,top,bottom:y,rowHeight:ROW_HEIGHT};
  });
  const summaryY=y+12;
  return {groups,summaryY,height:summaryY+SUMMARY_HEIGHT,dateMode,span};
}

export function receiptPrintSteps(duration,timeline) {
  const opening=Math.min(.18,duration*.04),ending=Math.min(1.2,duration*.12);
  const targets=[HEADER_HEIGHT,...timeline.groups.map(group=>group.bottom),timeline.height];
  const slot=(duration-opening-ending)/targets.length;
  return targets.map((to,index)=>({
    from:index?targets[index-1]:0,to,
    start:opening+slot*index,
    end:opening+slot*index+Math.min(slot*.34,index===targets.length-1 ? .48 : .36),
  }));
}

// A brief motor ramp, steady pull, and brake. The rest of each slot is
// completely still so the newly printed time block can be read.
function motorProgress(progress) {
  const ramp=.12,travel=1-ramp;
  if(progress<ramp)return progress*progress/(2*ramp*travel);
  if(progress>1-ramp)return 1-(1-progress)**2/(2*ramp*travel);
  return (progress-ramp/2)/travel;
}

export function receiptFrame(state,time,timeline=receiptTimeline(state),steps=receiptPrintSteps(state.duration,timeline)) {
  const duration=state.duration;
  const t=clamp(time,0,duration);
  let feed=0,printing=false,phase=0;
  for(const step of steps) {
    if(t<=step.start)break;
    if(t>=step.end){feed=step.to;continue;}
    phase=(t-step.start)/(step.end-step.start);
    feed=step.from+(step.to-step.from)*motorProgress(phase);
    printing=true;
    break;
  }
  const printed=timeline.groups.filter(group=>group.bottom<=feed+.0001);
  const totals=[0,1].map(side=>printed.reduce((sum,g)=>sum+g.sides[side].reduce((n,item)=>n+cents(item.amount),0),0)/100);
  return {feed,totals,printed,printing,phase,completed:feed>=timeline.height};
}
