type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

export async function settlePaidQueryCaptured(sql: Sql, record: any, payment: any, userId?: string) {
  const changed = await sql`
    UPDATE paid_query_orders
    SET payment_status='paid', status='submitted', payment_provider='razorpay',
        payment_reference=${payment.id}, razorpay_payment_id=${payment.id},
        paid_at=COALESCE(paid_at,now()), updated_at=now()
    WHERE id=${record.id}
      AND razorpay_order_id=${payment.order_id}
      AND amount_inr * 100 = ${payment.amount}
      AND (${userId || null}::uuid IS NULL OR user_profile_id=${userId || null}::uuid)
      AND payment_status='pending'
      AND refund_status NOT IN ('requested','processed')
      AND (razorpay_payment_id IS NULL OR razorpay_payment_id=${payment.id})
    RETURNING id
  `;
  if (changed.length) return "paid";

  const current = await sql`
    SELECT payment_status, refund_status, razorpay_payment_id
    FROM paid_query_orders
    WHERE id=${record.id}
      AND (${userId || null}::uuid IS NULL OR user_profile_id=${userId || null}::uuid)
    LIMIT 1
  `;
  if (!current.length) return "conflict";
  if (current[0].payment_status === "refunded" || current[0].refund_status === "processed") return "refunded";
  if (current[0].payment_status === "paid" && current[0].razorpay_payment_id === payment.id) return "paid";
  return "conflict";
}

export async function settlePaidQueryRefunded(sql: Sql, record: any, payment: any, userId?: string) {
  const amountRefunded = Number(payment.amount_refunded ?? 0);
  const amount = Number(record.amount_inr) * 100;
  if (!Number.isSafeInteger(amountRefunded) || amountRefunded < amount) return "partial_refund";

  const changed = await sql`
    UPDATE paid_query_orders
    SET payment_status='refunded', status='refunded', payment_provider='razorpay',
        payment_reference=${payment.id}, razorpay_payment_id=${payment.id},
        paid_at=COALESCE(paid_at,now()), refund_status='processed', updated_at=now()
    WHERE id=${record.id}
      AND razorpay_order_id=${payment.order_id}
      AND amount_inr * 100 = ${payment.amount}
      AND (${userId || null}::uuid IS NULL OR user_profile_id=${userId || null}::uuid)
      AND (razorpay_payment_id IS NULL OR razorpay_payment_id=${payment.id})
      AND payment_status IN ('pending','paid','refunded')
    RETURNING id
  `;
  if (changed.length) return "refunded";

  const current = await sql`
    SELECT payment_status, refund_status, razorpay_payment_id
    FROM paid_query_orders
    WHERE id=${record.id}
      AND (${userId || null}::uuid IS NULL OR user_profile_id=${userId || null}::uuid)
    LIMIT 1
  `;
  if (current[0]?.payment_status === "refunded" || current[0]?.refund_status === "processed") return "refunded";
  return "conflict";
}

export async function findPaidQueryByReference(sql: Sql, reference: string, userId: string) {
  const rows = await sql`
    SELECT id, reference_code, user_profile_id, razorpay_order_id, razorpay_payment_id,
           payment_status, refund_status, amount_inr
    FROM paid_query_orders
    WHERE reference_code=${reference} AND user_profile_id=${userId}
    LIMIT 1
  `;
  return rows[0] || null;
}
