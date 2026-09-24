const http=require('http');
const {WebSocketServer}=require('ws');
const crypto=require('crypto');
const port=process.env.PORT||3000, rooms=new Map();
const colors=['red','yellow','green','blue'];
const vals=['0','1','2','3','4','5','6','7','8','9','skip','reverse','+2'];
const send=(ws,o)=>{if(ws.readyState===1)ws.send(JSON.stringify(o))};
function fail(ws,message){send(ws,{type:'error',message})}
function deck(){
 let a=[];
 for(const color of colors){a.push({color,val:'0'});for(const val of vals.slice(1))for(let k=0;k<2;k++)a.push({color,val})}
 for(let i=0;i<4;i++){a.push({color:'wild',val:'wild'},{color:'wild',val:'+4'})}
 for(let i=a.length-1;i>0;i--){let j=crypto.randomInt(i+1);[a[i],a[j]]=[a[j],a[i]]}
 return a;
}
function draw(r,n){
 while(r.deck.length<n&&r.pile.length>1){
  const top=r.pile.pop(); const old=r.pile.splice(0);
  for(const c of old)r.deck.push(c);
  r.pile.push(top);
 }
 return r.deck.splice(0,n);
}
function next(r,steps=1){r.turn=(r.turn+steps*r.dir+r.players.length*10)%r.players.length}
function broadcast(r){
 for(let i=0;i<r.players.length;i++){
  const p=r.players[i];
  send(p.ws,{type:'state',room:r.code,you:i,players:r.players.map(x=>({name:x.name,cards:x.hand.length})),hand:p.hand,started:r.started,turn:r.turn,top:r.pile.at(-1),active:r.active,dir:r.dir,winner:r.winner,log:r.log});
 }
}
function play(r,p,index,color){
 const c=p.hand[index], top=r.pile.at(-1);
 if(!c)return fail(p.ws,'Card not found');
 if(c.color!=='wild'&&c.color!==r.active&&c.val!==top.val)return fail(p.ws,'Card does not match');
 if(c.color==='wild'&&!colors.includes(color))return fail(p.ws,'Choose a color');
 p.hand.splice(index,1); r.pile.push(c); r.active=c.color==='wild'?color:c.color;
 r.log=p.name+' played '+c.val;
 if(!p.hand.length){r.winner=p.name;r.started=false;return broadcast(r)}
 if(c.val==='reverse'){r.dir*=-1;next(r,r.players.length===2?2:1)}
 else if(c.val==='skip')next(r,2);
 else if(c.val==='+2'||c.val==='+4'){next(r);const n=c.val==='+2'?2:4;r.players[r.turn].hand.push(...draw(r,n));r.log+='; '+r.players[r.turn].name+' drew '+n;next(r)}
 else next(r);
 broadcast(r);
}
const fs=require('fs');
const path=require('path');
const server=http.createServer((req,res)=>{
 if(req.url==='/'||req.url==='/index.html'){
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache'});
  fs.createReadStream(path.join(__dirname,'index.html')).pipe(res);
 }else if(req.url==='/health'){
  res.writeHead(200,{'content-type':'text/plain'});
  res.end('Crazy Cards game server online');
 }else{res.writeHead(404);res.end('Not found')}
});
const wss=new WebSocketServer({server,maxPayload:4096});
wss.on('connection',ws=>{
 let room=null, player=null;
 ws.on('message',raw=>{
  let m; try{m=JSON.parse(raw)}catch{return fail(ws,'Invalid message')}
  if(!m||typeof m.type!=='string')return;
  if(m.type==='create'||m.type==='join'){
   if(room)return fail(ws,'Already in a room');
   const name=String(m.name||'Player').trim().slice(0,18)||'Player';
   if(m.type==='create'){
    let code; do{code=String(crypto.randomInt(100000,1000000))}while(rooms.has(code));
    room={code,players:[],deck:[],pile:[],active:'',started:false,turn:0,dir:1,winner:'',log:''};
    rooms.set(code,room);
   }else{
    room=rooms.get(String(m.code||'').trim());
    if(!room)return fail(ws,'Room not found');
    if(room.started||room.players.length>=4){room=null;return fail(ws,'Room full or game already started')}
   }
   player={ws,name,hand:[]}; room.players.push(player); room.log=name+' joined'; broadcast(room); return;
  }
  if(!room||!player)return fail(ws,'Create or join a room first');
  if(m.type==='start'){
   if(room.players[0]!==player)return fail(ws,'Only the room host can start');
   if(room.players.length<2)return fail(ws,'Need at least 2 players');
   room.deck=deck(); room.pile=[]; room.players.forEach(p=>p.hand=draw(room,7));
   let top=draw(room,1)[0];
   while(top&&top.color==='wild'){room.deck.unshift(top);top=draw(room,1)[0]}
   room.pile.push(top); room.active=top.color; room.turn=0; room.dir=1; room.started=true; room.winner=''; room.log='Game started';
   return broadcast(room);
  }
  if(!room.started||room.players[room.turn]!==player)return fail(ws,'Not your turn');
  if(m.type==='play')return play(room,player,Number(m.index),m.color);
  if(m.type==='draw'){player.hand.push(...draw(room,1));room.log=player.name+' drew a card';next(room);return broadcast(room)}
 });
 ws.on('close',()=>{
  if(!room||!player)return;
  room.players=room.players.filter(p=>p!==player); room.started=false; room.winner=''; room.log=player.name+' disconnected; game ended'; room.turn=0;
  if(!room.players.length)rooms.delete(room.code); else broadcast(room);
 });
});
server.listen(port,'0.0.0.0',()=>console.log('Crazy Cards server listening on '+port));
