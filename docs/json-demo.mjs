const event = {id: "event1", title: "Lagos event", city: "Lagos", date: "2026-10-27", tiers:["General", "VIP"]};

const text = JSON.stringify(event);
 
console.log(text);
console.log(JSON.parse(text));