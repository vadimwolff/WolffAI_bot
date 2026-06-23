import { deletePromo } from "./src/lib/promoService";

async function testDelete() {
    console.log("Deleting...");
    const res = await deletePromo("WAI-YVTI-5TXU-9HEC");
    console.log("Result:", res);
}

testDelete();
