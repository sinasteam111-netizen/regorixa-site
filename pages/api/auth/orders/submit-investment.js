// pages/api/auth/orders/submit-investment.js
import handler from "./create-plan";

// این endpoint فقط برای سازگاری با فرانت‌های قدیمی است
export default async function submitInvestment(req, res) {
  return handler(req, res);
}