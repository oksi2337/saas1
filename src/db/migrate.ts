/**
 * 마이그레이션 실행 스크립트.
 * 사용법: npm run db:migrate
 *
 * drizzle/migrations/ 폴더의 SQL 파일을 순서대로 실행한다.
 * 이미 실행된 마이그레이션은 __drizzle_migrations 테이블로 추적하여 재실행하지 않는다.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'path';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 환경변수가 필요합니다.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
  });

  const db = drizzle(pool);

  console.log('마이그레이션 시작...');

  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), 'drizzle/migrations'),
  });

  console.log('마이그레이션 완료.');
  await pool.end();
}

main().catch((err) => {
  console.error('마이그레이션 오류:', err);
  process.exit(1);
});
