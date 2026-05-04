/**
 * Excel 리포트 생성 skill.
 * exceljs로 워크북 생성 후 로컬 파일 저장 (스토리지 업로드는 stub).
 * 실제 배포 시 Vercel Blob / S3 업로드로 교체한다.
 */
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { HealthMetrics, WarningItem } from '../place-health-score';

// ── Types ─────────────────────────────────────────────────

export interface PlatformSummary { platform: string; review_count: number; avg_rating: number | null; }
export interface RatingSummary   { rating: number; count: number; }
export interface KeywordCount    { keyword: string; count: number; }
export interface MenuInsight     { menu: string; mention_count: number; negative_count: number; suggestion: string; }

export interface ExcelReportInput {
  store_id: string;
  store_name: string;
  report_type: 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  health: {
    score: number | null;
    score_delta: number | null;
    score_label: string;
    metrics: HealthMetrics;
    warning_items: WarningItem[];
  };
  reviews: {
    total_count: number;
    avg_rating: number | null;
    avg_rating_delta: number | null;
    by_platform: PlatformSummary[];
    by_rating: RatingSummary[];
    top_positive_keywords: KeywordCount[];
    top_negative_keywords: KeywordCount[];
    menu_insights: MenuInsight[];
    unanswered_count: number;
    all_reviews?: Array<{ reviewed_at: Date; platform: string; rating: number | null; content: string; replied: boolean }>;
  };
}

export type ExcelReportOutput =
  | { status: 'success'; file_url: string; file_name: string; file_size_bytes: number }
  | { status: 'failed'; error_message: string; file_url: null };

// ── Constants ─────────────────────────────────────────────

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A5276' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, name: '맑은 고딕' };
const SCORE_COLORS: Record<string, string> = {
  '우수': 'FF1E8449', '양호': 'FF27AE60', '보통': 'FFF39C12', '주의': 'FFE67E22', '위험': 'FFC0392B',
};

// ── Main ──────────────────────────────────────────────────

export async function generateExcelReport(input: ExcelReportInput): Promise<ExcelReportOutput> {
  try {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Review SaaS';
    wb.created = new Date();

    addSummarySheet(wb, input);
    addReviewSheet(wb, input);
    addKeywordSheet(wb, input);
    if (input.reviews.menu_insights.length > 0) addMenuInsightSheet(wb, input);
    addPlaceMetricsSheet(wb, input);
    if (input.reviews.all_reviews) addAllReviewsSheet(wb, input);

    // 파일 저장 (stub: 로컬 reports/ 디렉토리)
    const dir = path.resolve('./reports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const sanitizedName = input.store_name.replace(/\s+/g, '');
    const period = `${input.period_start.slice(0, 7).replace('-', '년')}월`;
    const fileName = `${sanitizedName}_${period}_리포트.xlsx`;
    const filePath = path.join(dir, `${uuidv4()}_${fileName}`);

    const buffer = await wb.xlsx.writeBuffer();
    fs.writeFileSync(filePath, Buffer.from(buffer));

    return {
      status: 'success',
      file_url:         `file://${filePath}`,
      file_name:        fileName,
      file_size_bytes:  buffer.byteLength,
    };
  } catch (err) {
    return {
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
      file_url: null,
    };
  }
}

// ── Sheets ────────────────────────────────────────────────

function addSummarySheet(wb: ExcelJS.Workbook, input: ExcelReportInput): void {
  const ws = wb.addWorksheet('요약');
  ws.columns = [{ width: 20 }, { width: 35 }];

  addHeaderRow(ws, ['항목', '내용'], [20, 35]);

  const scoreColor = SCORE_COLORS[input.health.score_label] ?? 'FF888888';
  const rows: [string, string][] = [
    ['매장명',    input.store_name],
    ['기간',      `${input.period_start} ~ ${input.period_end}`],
    ['생성일',    new Date().toISOString().slice(0, 10)],
    ['헬스 스코어', input.health.score !== null ? `${input.health.score}점 (${input.health.score_label})` : '집계 불가'],
    ['전기 대비', input.health.score_delta !== null ? `${input.health.score_delta > 0 ? '+' : ''}${input.health.score_delta}점` : '-'],
    ['총 리뷰 수', `${input.reviews.total_count}건`],
    ['평균 별점',  input.reviews.avg_rating !== null ? `${input.reviews.avg_rating.toFixed(1)}점` : '-'],
    ['미답글 리뷰', `${input.reviews.unanswered_count}건`],
  ];

  for (const [label, value] of rows) {
    ws.addRow([label, value]);
  }

  if (input.health.warning_items.length > 0) {
    ws.addRow([]);
    ws.addRow(['⚠ 경고 항목', '']);
    for (const w of input.health.warning_items) {
      if (w.type === 'no_impressions_data') continue;
      ws.addRow([`[${w.severity}] ${w.message}`, w.suggestion]);
    }
  }

  // 헬스 스코어 행 배경색
  const scoreRow = ws.getRow(4);
  scoreRow.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: scoreColor } };
  scoreRow.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' }, name: '맑은 고딕' };
}

function addReviewSheet(wb: ExcelJS.Workbook, input: ExcelReportInput): void {
  const ws = wb.addWorksheet('리뷰 현황');
  ws.columns = [{ width: 18 }, { width: 12 }, { width: 12 }];

  addHeaderRow(ws, ['플랫폼', '리뷰 수', '평균 별점'], [18, 12, 12]);
  for (const p of input.reviews.by_platform) {
    ws.addRow([p.platform, p.review_count, p.avg_rating?.toFixed(1) ?? '-']);
  }

  ws.addRow([]);
  addHeaderRow(ws, ['별점', '건수'], [18, 12]);
  for (const r of input.reviews.by_rating.sort((a, b) => b.rating - a.rating)) {
    ws.addRow([`⭐${r.rating}점`, r.count]);
  }
}

function addKeywordSheet(wb: ExcelJS.Workbook, input: ExcelReportInput): void {
  const ws = wb.addWorksheet('키워드 분석');
  ws.columns = [{ width: 20 }, { width: 8 }, { width: 4 }, { width: 20 }, { width: 8 }];

  addHeaderRow(ws, ['긍정 키워드', '빈도', '', '부정 키워드', '빈도'], [20, 8, 4, 20, 8]);
  const maxLen = Math.max(input.reviews.top_positive_keywords.length, input.reviews.top_negative_keywords.length);
  for (let i = 0; i < maxLen; i++) {
    const pos = input.reviews.top_positive_keywords[i];
    const neg = input.reviews.top_negative_keywords[i];
    ws.addRow([pos?.keyword ?? '', pos?.count ?? '', '', neg?.keyword ?? '', neg?.count ?? '']);
  }
}

function addMenuInsightSheet(wb: ExcelJS.Workbook, input: ExcelReportInput): void {
  const ws = wb.addWorksheet('메뉴 인사이트');
  ws.columns = [{ width: 18 }, { width: 10 }, { width: 10 }, { width: 45 }];
  addHeaderRow(ws, ['메뉴', '언급', '부정', '개선 제안'], [18, 10, 10, 45]);
  for (const m of input.reviews.menu_insights) {
    const row = ws.addRow([m.menu, m.mention_count, m.negative_count, m.suggestion]);
    if (m.negative_count >= 3) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
    }
  }
}

function addPlaceMetricsSheet(wb: ExcelJS.Workbook, input: ExcelReportInput): void {
  const ws = wb.addWorksheet('플레이스 지표');
  ws.columns = [{ width: 22 }, { width: 20 }];
  addHeaderRow(ws, ['지표', '값'], [22, 20]);

  const m = input.health.metrics;
  if (m.impression_count === null) {
    ws.addRow(['안내', '이번 기간 네이버 플레이스 통계 수집 불가 (파트너센터 연동 필요)']);
  } else {
    ws.addRow(['노출수',   m.impression_count]);
    ws.addRow(['클릭수',   m.click_count]);
    ws.addRow(['클릭률',   m.click_rate !== null ? (m.click_rate * 100).toFixed(1) + '%' : '-']);
    ws.addRow(['전화 클릭', m.phone_click]);
    ws.addRow(['길찾기 클릭', m.direction_click]);
    ws.addRow(['저장(찜)', m.save_click]);
  }
  ws.addRow(['마지막 사진 업로드', `${m.days_since_last_photo}일 전`]);
}

function addAllReviewsSheet(wb: ExcelJS.Workbook, input: ExcelReportInput): void {
  const all = input.reviews.all_reviews;
  if (!all) return;

  const ws = wb.addWorksheet('전체 리뷰 목록');
  ws.columns = [{ width: 14 }, { width: 12 }, { width: 8 }, { width: 60 }, { width: 8 }];
  addHeaderRow(ws, ['작성일', '플랫폼', '별점', '내용', '답글'], [14, 12, 8, 60, 8]);

  for (const r of all) {
    const row = ws.addRow([
      r.reviewed_at.toISOString().slice(0, 10),
      r.platform,
      r.rating ?? '-',
      r.content,
      r.replied ? 'O' : 'X',
    ]);
    if (r.rating !== null && r.rating <= 2) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4EC' } };
    }
  }
}

// ── Util ──────────────────────────────────────────────────

function addHeaderRow(ws: ExcelJS.Worksheet, labels: string[], widths: number[]): void {
  const row = ws.addRow(labels);
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'center' };
  });
  labels.forEach((_, i) => {
    ws.getColumn(i + 1).width = widths[i];
  });
}
