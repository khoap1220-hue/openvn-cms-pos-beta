import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== 1. LÀM SẠCH CẤU HÌNH MẪU TRONG INTEGRATION / WEBHOOK / APP SETTING (SUPABASE) ===')

  // Xóa các WebhookEndpoint mẫu (.local) và SocialChannelConfig mẫu
  const delWebhooks = await prisma.webhookEndpoint.deleteMany({
    where: { url: { contains: '.local' } },
  })
  const delSocialCfg = await prisma.socialChannelConfig.deleteMany()

  // Đặt lại IntegrationCredential: chỉ giữ SHOPEE (thaimy1605 - 197195817) là CONNECTED, còn lại làm rỗng config mẫu
  const allCreds = await prisma.integrationCredential.findMany()
  for (const cred of allCreds) {
    if (cred.provider === 'SHOPEE') {
      await prisma.integrationCredential.update({
        where: { id: cred.id },
        data: {
          config: JSON.stringify({
            shopId: '197195817',
            username: 'thaimy1605',
            spcU: '197198798',
            spcCds: 'c2344aba-5428-425d-bba9-04838a499109',
            mode: 'SELLER_CENTER_V3_SESSION',
            connected: true,
          }),
        },
      })
    } else {
      await prisma.integrationCredential.update({
        where: { id: cred.id },
        data: {
          config: JSON.stringify({ connected: false }),
        },
      })
    }
  }

  // Làm sạch AppSetting mẫu (xóa unit conversion của SP mẫu đã xóa, xóa bank/company mẫu)
  await prisma.appSetting.deleteMany({
    where: {
      key: {
        in: [
          'product_unit_conversions_v1',
          'gemini_api_key',
          'invoice_bank_name',
          'invoice_bank_account',
          'invoice_bank_holder',
          'invoice_footer_note',
          'company_phone',
          'company_name',
        ],
      },
    },
  })

  console.log(`✅ Đã xóa ${delWebhooks.count} WebhookEndpoint mẫu, ${delSocialCfg.count} SocialChannelConfig mẫu, và làm sạch 14 IntegrationCredential + AppSetting mẫu.`)

  console.log('\n=== 2. KHỞI TẠO CÁC SCHEMA ĐỘC LẬP CHO TỪNG HỆ THỐNG TRÊN SUPABASE POSTGRESQL ===')
  const isolatedSchemas = ['openvn_cms', 'bo_studio', 'iotfarm', 'game_studio', 'beta_sandbox']
  for (const schemaName of isolatedSchemas) {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}";`)
    await prisma.$executeRawUnsafe(`REVOKE ALL ON SCHEMA "${schemaName}" FROM PUBLIC;`)
    await prisma.$executeRawUnsafe(`GRANT ALL ON SCHEMA "${schemaName}" TO postgres;`)
    console.log(`✅ Đã thiết lập Schema cô lập: "${schemaName}" (REVOKE PUBLIC, chỉ cho phép kết nối định danh)`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
