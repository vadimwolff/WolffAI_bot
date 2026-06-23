async function main() {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
    headers: { Authorization: `Bearer ${openrouterKey}` }
  });
  const data = await res.json();
  console.log(data);
}
main().catch(console.error);