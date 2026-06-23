
fetch("http://localhost:3000/api/admin/promocodes/delete", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: "WAI-YVTI-5TXU-9HEC" }),
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
