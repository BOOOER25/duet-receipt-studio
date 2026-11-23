import {clamp,cents} from './core.js';

export const HEADER_HEIGHT=104;
const ROW_HEIGHT=94, GROUP_GAP=18, SUMMARY_HEIGHT=166;

// Consumption time, shared by both people, is the only ordering source.
// Legacy per-item animation offsets are deliberately not used by receipts.
export function receiptTimeline(state) {
  const byHour=new Map();
  for(const item of state.items) {
    const hour=Number(item.clock.slice(0,2));
    if(!byHour.has(hour))byHour.set(hour,{hour,label:`${hour}点`,sides:[[],[]]});
    byHour.get(hour).sides[item.side].push(item);
  }
  let y=HEADER_HEIGHT;
  const groups=[...byHour.values()].sort((a,b)=>a.hour-b.hour).map(group=>{
    for(const items of group.sides)items.sort((a,b)=>a.clock.localeCompare(b.clock)||a.id.localeCompare(b.id));
    const top=y,rows=Math.max(...group.sides.map(items=>items.length),1);
    y+=rows*ROW_HEIGHT+GROUP_GAP;
    return {...group,top,bottom:y,rowHeight:ROW_HEIGHT};
  });
  const summaryY=y+12;
  return {groups,summaryY,height:summaryY+SUMMARY_HEIGHT};
}

export function receiptFrame(state,time,timeline=receiptTimeline(state)) {
  const duration=state.duration;
  const first=timeline.groups[0]?.hour??0,last=timeline.groups.at(-1)?.hour??first;
  const points=[{at:0,feed:0},{at:.35,feed:HEADER_HEIGHT}];
  for(const group of timeline.groups) {
    const proportion=last===first?1:(group.hour-first)/(last-first);
    points.push({at:.65+proportion*(duration-1.5),feed:group.bottom});
  }
  points.push({at:duration-.15,feed:timeline.height});
  const t=clamp(time,0,duration);
  let feed=timeline.height;
  for(let i=1;i<points.length;i++) {
    const previous=points[i-1],next=points[i];
    if(t<=next.at) {
      const progress=clamp((t-previous.at)/(next.at-previous.at),0,1);
      feed=previous.feed+(next.feed-previous.feed)*progress;
      break;
    }
  }
  const printed=timeline.groups.filter(group=>group.bottom<=feed+.0001);
  const totals=[0,1].map(side=>printed.reduce((sum,g)=>sum+g.sides[side].reduce((n,item)=>n+cents(item.amount),0),0)/100);
  return {feed,totals,printed,completed:feed>=timeline.height};
}
