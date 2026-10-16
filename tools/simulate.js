require('../engine.js');
const {Game,Bot}=globalThis.Snaked;
(async()=>{
for(let n=2;n<=6;n++){let hits=0,rounds=0,steals=0,notrump=0,stolenLead=0,tricks=0;
 for(let g=0;g<400;g++){
  const agents=Array.from({length:n},()=>Bot);
  const game=new Game(Array.from({length:n},(_,i)=>'P'+i),agents,{event:async(t,d)=>{if(t==='trump'&&!d.trump)notrump++;if(t==='steal')steals++;if(t==='trickwon'){tricks++;if(d.stolen)stolenLead++}}});
  await game.run();
  game.players.forEach(p=>p.history.forEach(r=>{rounds++;if(r.hit)hits++}));
 }
 console.log(n,'players: frog hit rate',(hits/rounds).toFixed(2),'| no-trump rounds',(notrump/1200).toFixed(2),'| steals/round',(steals/1200).toFixed(2),'| lead stolen by snake',(stolenLead/tricks).toFixed(2));
}})().catch(e=>{console.error(e);process.exit(1)});
