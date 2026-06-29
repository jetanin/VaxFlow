// Unit tests — pure helpers (ไม่ต้องใช้ DB)
const { tmtOf, NEXT_STATE } = require("../server");
const { _median } = require("../seed");

describe("tmtOf — product_id → TMT (ATC กลาง)", () => {
  test("ดึง ATC จาก product_id", () => {
    expect(tmtOf("VAX_J07BX03_048")).toBe("TMT-J07BX03");
    expect(tmtOf("VAX_J07BC02_002")).toBe("TMT-J07BC02");
  });
  test("ไม่มี underscore → ใช้ทั้งก้อน", () => {
    expect(tmtOf("ABC")).toBe("TMT-ABC");
  });
});

describe("NEXT_STATE — vaccine state machine", () => {
  test("เดินหน้าทางเดียว DEEP_FROZEN → THAWED → OPENED", () => {
    expect(NEXT_STATE.DEEP_FROZEN).toBe("THAWED");
    expect(NEXT_STATE.THAWED).toBe("OPENED");
    expect(NEXT_STATE.OPENED).toBeUndefined();   // OPENED เป็นปลายทาง ห้ามไปต่อ
  });
});

describe("_median — ใช้ใน screen_at_risk (เกณฑ์บริโภค)", () => {
  test("คี่/คู่", () => {
    expect(_median([1, 2, 3])).toBe(2);
    expect(_median([1, 2, 3, 4])).toBe(2.5);
  });
  test("กรองค่า <= 0 ออก · ว่าง → 0", () => {
    expect(_median([0, 0, 4])).toBe(4);
    expect(_median([])).toBe(0);
    expect(_median([0, 0])).toBe(0);
  });
});
