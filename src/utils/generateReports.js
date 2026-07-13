import * as fs from 'fs';
import {
    AlignmentType,
    BorderStyle,
    ExternalHyperlink,
    ImageRun,
    Paragraph,
    patchDocument,
    PatchType,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
} from 'docx';
import topdf from 'docx2pdf-converter';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import https from 'https';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { BlobServiceClient } from '@azure/storage-blob';

import {
    formatHttpsURL,
    getOrdinalSuffix,
    getRiskColor,
    isValidURL,
} from './helpers.js';

let template = 'aramco_template.docx';
let links = [];
const kpi_codes = ['NWS1A', 'ONF1A'];

// ─── Azure Storage — Reports ──────────────────────────────────────────────────
const { BLOB_STORAGE__CONNECTION_STRING } = process.env;

const blobServiceClient = BlobServiceClient.fromConnectionString(
    BLOB_STORAGE__CONNECTION_STRING,
);

// ─── Azure Storage — Images (same account, separate container) ───────────────
const IMAGES_CONTAINER_NAME = process.env.IMAGES_CONTAINER_NAME || 'entity-images';
const imagesContainerClient = blobServiceClient.getContainerClient(IMAGES_CONTAINER_NAME);

/**
 * Download a single image blob from Azure and return its Buffer.
 * Throws if the blob does not exist.
 */
const downloadImageBufferFromAzure = async (blobName) => {
    const blobClient = imagesContainerClient.getBlockBlobClient(blobName);
    const downloadResponse = await blobClient.download();
    if (!downloadResponse.readableStreamBody) {
        throw new Error(`No stream returned for blob: ${blobName}`);
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        downloadResponse.readableStreamBody.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        downloadResponse.readableStreamBody.on('end', () => resolve(Buffer.concat(chunks)));
        downloadResponse.readableStreamBody.on('error', reject);
    });
};

// ─── Upload helpers ───────────────────────────────────────────────────────────
const uploadToAzure = async (filePath, fileName, session_id) => {
    try {
        const containerClient = blobServiceClient.getContainerClient('generated-reports');
        const blobClient = containerClient.getBlockBlobClient(fileName);
        await blobClient.uploadData(fs.readFileSync(filePath));
        return blobClient.url;
    } catch (error) {
        console.error(`Error uploading ${fileName} to Azure:`, error);
    }
};

const {
    R2_STORAGE__STORAGE_ACCOUNT_URL,
    R2_STORAGE__STORAGE_CONTAINER_NAME,
    R2_STORAGE__ACCESS_KEY,
    R2_STORAGE__SECREATE_ACCOUNT_KEY,
} = process.env;

const s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_STORAGE__STORAGE_ACCOUNT_URL,
    credentials: {
        accessKeyId: R2_STORAGE__ACCESS_KEY,
        secretAccessKey: R2_STORAGE__SECREATE_ACCOUNT_KEY,
    },
    requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    }),
});

const uploadBufferToAzure = async (data, fileName, session_id) => {
    try {
        const containerClient = blobServiceClient.getContainerClient('generated-reports');
        const blobClient = containerClient.getBlockBlobClient(fileName);
        await blobClient.upload(data, data.length);
        return blobClient.url;
    } catch (error) {
        console.error(`Error uploading ${fileName} to Azure:`, error);
    }
};

const uploadBufferToR2 = async (data, fileName, session_id) => {
    const bucket = process.env.R2_STORAGE__STORAGE_CONTAINER_NAME || 'generated-reports';
    const key = `${session_id}/${fileName}`;
    try {
        await s3Client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data }));
        const fileUrl = `${process.env.R2_STORAGE__STORAGE_ACCOUNT_URL}/${key}`;
        console.log(`✅ Uploaded successfully: ${fileUrl}`);
        return fileUrl;
    } catch (err) {
        console.error(`❌ Failed to upload ${key} to R2:`, err);
        return null;
    }
};

const uploadToR2 = async (filePath, fileName, session_id) => {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        await s3Client.send(new PutObjectCommand({
            Bucket: R2_STORAGE__STORAGE_CONTAINER_NAME,
            Key: `${session_id}/${fileName}`,
            Body: fileBuffer,
        }));
        const fileUrl = `${R2_STORAGE__STORAGE_ACCOUNT_URL}/${R2_STORAGE__STORAGE_CONTAINER_NAME}/${session_id}/${fileName}`;
        console.log(`✅ Uploaded ${fileName} to R2: ${fileUrl}`);
        return fileUrl;
    } catch (error) {
        console.error(`❌ Error uploading ${fileName} to R2:`, error);
    }
};

// ─── Border helpers ───────────────────────────────────────────────────────────
const borders = {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'D3D3D3' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D3D3D3' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'D3D3D3' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'D3D3D3' },
};

const noBorders = {
    top: { style: BorderStyle.NONE },
    bottom: { style: BorderStyle.NONE },
    left: { style: BorderStyle.NONE },
    right: { style: BorderStyle.NONE },
};

// ─── Shared helpers ───────────────────────────────────────────────────────────
const createTextRun = (options) => ({
    type: PatchType.PARAGRAPH,
    children: [new TextRun(options)],
});

const createCell = (
    text,
    { background = 'F2F2F2', alignment = 'center', bold = true, columnSpan = 1, ...rest } = {},
) => {
    return new TableCell({
        verticalAlign: 'center',
        children: [
            ...String(text ?? '').split(/\n+/).map((t) => {
                const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
                const match = t.match(re);
                if (match) {
                    const inner = match[0].replace(/<p>/g, '').replace(/<\/p>/g, '');
                    return new Paragraph({
                        alignment,
                        children: [new TextRun({ text: inner, bold, size: 20, highlight: 'yellow' })],
                    });
                }
                return new Paragraph({
                    alignment,
                    children: [new TextRun({ text: t, bold, size: 20 })],
                });
            }),
        ],
        shading: { fill: background },
        columnSpan: columnSpan || 1,
        ...rest,
    });
};

const highlightRating = (rating) => ({
    type: PatchType.DOCUMENT,
    children: [
        new Table({
            width: { size: 15, type: WidthType.PERCENTAGE },
            borders: {
                top: { style: BorderStyle.NONE },
                bottom: { style: BorderStyle.NONE },
                left: { style: BorderStyle.NONE },
                right: { style: BorderStyle.NONE },
            },
            rows: [
                new TableRow({
                    height: { rule: 'atLeast', value: 550 },
                    children: [
                        new TableCell({
                            verticalAlign: 'center',
                            shading: { fill: getRiskColor(rating).background },
                            children: [
                                new Paragraph({
                                    alignment: 'center',
                                    children: [
                                        new TextRun({ text: `${rating}`, color: getRiskColor(rating).color, bold: true }),
                                    ],
                                }),
                            ],
                        }),
                    ],
                }),
            ],
        }),
    ],
});

const noAnnexure = () => [
    new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                height: { rule: 'atLeast', value: 500 },
                children: [
                    new TableCell({
                        verticalAlign: 'center',
                        shading: { fill: 'F2F2F2' },
                        children: [
                            new Paragraph({
                                alignment: 'center',
                                children: [new TextRun({ text: 'NO ANNEXURE', bold: true, size: 20 })],
                            }),
                        ],
                    }),
                ],
            }),
        ],
    }),
    new Paragraph({}),
];

const createNoHitsTable = (text = '') => [
    new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                height: { rule: 'atLeast', value: 500 },
                children: [
                    new TableCell({
                        verticalAlign: 'center',
                        shading: { fill: 'F2F2F2' },
                        children: [
                            new Paragraph({
                                alignment: 'center',
                                children: [
                                    new TextRun({
                                        text: text ? `${text} - NO TRUE HITS IDENTIFIED` : 'NO TRUE HITS IDENTIFIED',
                                        bold: true,
                                        size: 20,
                                    }),
                                ],
                            }),
                        ],
                    }),
                ],
            }),
        ],
    }),
    new Paragraph({}),
];

// ─── Address Validation Image Table ──────────────────────────────────────────
// Downloads _building, _street, _satellite from Azure and renders side-by-side.
// Silently skips any missing images — empty array if none found.
const createAddressValidationTable = async (entityId) => {
    if (!entityId) return [];

    const imageKeys = [
        `${entityId}_building.jpg`,
        `${entityId}_street.jpg`,
        `${entityId}_satellite.jpg`,
    ];

    const existingImages = [];
    for (const key of imageKeys) {
        try {
            const buffer = await downloadImageBufferFromAzure(key);
            console.log(`✅ Fetched address image: ${key}`);
            existingImages.push({ key, buffer });
        } catch {
            console.log(`ℹ️  Address image not found in Azure: ${key}`);
        }
    }

    if (!existingImages.length) return [];

    const cw = Math.floor(100 / existingImages.length);
    const ob = { style: BorderStyle.SINGLE, size: 6, color: 'D9D9D9' };
    const NONE = { style: BorderStyle.NONE };

    return [
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorders,
            rows: [
                new TableRow({
                    cantSplit: true,
                    children: [
                        new TableCell({
                            shading: { fill: 'ffffff' },
                            borders: noBorders,
                            margins: { top: 0, bottom: 0, left: 0, right: 0 },
                            children: [
                                new Paragraph({
                                    spacing: { before: 160, after: 80 },
                                    children: [new TextRun({ text: 'Address Validation', bold: true, size: 24 })],
                                }),
                                new Table({
                                    width: { size: 100, type: WidthType.PERCENTAGE },
                                    borders: { top: ob, bottom: ob, left: ob, right: ob, insideH: NONE, insideV: NONE },
                                    rows: [
                                        new TableRow({
                                            children: existingImages.map(({ buffer }, idx) =>
                                                new TableCell({
                                                    width: { size: cw, type: WidthType.PERCENTAGE },
                                                    shading: { fill: 'ffffff' },
                                                    margins: { top: 150, bottom: 150, left: 150, right: 150 },
                                                    borders: {
                                                        top: ob,
                                                        bottom: ob,
                                                        left: idx === 0 ? ob : NONE,
                                                        right: idx === existingImages.length - 1 ? ob : NONE,
                                                    },
                                                    children: [
                                                        new Paragraph({
                                                            alignment: AlignmentType.CENTER,
                                                            children: [
                                                                new ImageRun({
                                                                    data: buffer,
                                                                    type: 'jpg',
                                                                    transformation: { width: 180, height: 120 },
                                                                }),
                                                            ],
                                                        }),
                                                    ],
                                                }),
                                            ),
                                        }),
                                    ],
                                }),
                            ],
                        }),
                    ],
                }),
            ],
        }),
        new Paragraph({}),
    ];
};

// ─── Inner indicator table (Financial / ESG / Cyber) ─────────────────────────
const createFindingsInnerTable = (findings) => [
    new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                height: { rule: 'atLeast', value: 500 },
                children: [
                    createCell('Name & Relation', { background: 'f2f2f2', alignment: 'left', width: { size: 20, type: WidthType.PERCENTAGE } }),
                    createCell(findings.title, { background: 'ffffff', alignment: 'center', bold: false, width: { size: 50, type: WidthType.PERCENTAGE } }),
                    createCell('Rating', { width: { size: 15, type: WidthType.PERCENTAGE } }),
                    createCell(findings.rating, { background: 'ffffff', alignment: 'center', bold: false, width: { size: 15, type: WidthType.PERCENTAGE } }),
                ],
            }),
            new TableRow({
                height: { rule: 'atLeast', value: 500 },
                children: [createCell('Findings', { columnSpan: 4, alignment: 'left', background: 'f2f2f2' })],
            }),
            new TableRow({
                height: { rule: 'atLeast', value: 500 },
                children: [
                    new TableCell({
                        shading: { fill: 'ffffff' },
                        columnSpan: 4,
                        children: [
                            new Paragraph({ children: [new TextRun({ break: 1 })] }),
                            new Table({
                                width: { size: 100, type: WidthType.PERCENTAGE },
                                rows: [
                                    new TableRow({
                                        height: { rule: 'atLeast', value: 500 },
                                        children: [
                                            createCell(findings.inner_title, { width: { size: 30, type: WidthType.PERCENTAGE } }),
                                            createCell('Rating', { width: { size: 15, type: WidthType.PERCENTAGE } }),
                                            createCell('Notes', { width: { size: 55, type: WidthType.PERCENTAGE } }),
                                        ],
                                    }),
                                    ...findings.data.map((item) =>
                                        new TableRow({
                                            height: { rule: 'atLeast', value: 500 },
                                            children: [
                                                createCell(item.kpi_definition, { background: 'ffffff', bold: false, width: { size: 30, type: WidthType.PERCENTAGE } }),
                                                createCell(item.kpi_rating, { background: 'ffffff', bold: false, width: { size: 15, type: WidthType.PERCENTAGE } }),
                                                createCell(item.kpi_details, { background: 'ffffff', bold: false, width: { size: 55, type: WidthType.PERCENTAGE } }),
                                            ],
                                        }),
                                    ),
                                ],
                            }),
                            new Paragraph({}),
                            new Paragraph({
                                children: [
                                    new TextRun({ text: 'Source:', bold: true }),
                                    new TextRun({ text: ' EY Network Alliance Databases' }),
                                ],
                            }),
                            new Paragraph({}),
                            findings.inner_title === 'ESG Indicators' &&
                            new Paragraph({
                                children: [
                                    new TextRun({ text: 'Notes:', bold: true, break: 1, underline: true }),
                                    new TextRun({ text: '', break: 1 }),
                                    new TextRun({ text: 'ESG Ratings ', bold: true }),
                                    new TextRun({ text: '(if applicable): High/Weak : 0-29; Medium/Moderate: 30-49; Low/Robust: 50-100', break: 1 }),
                                ],
                            }),
                            new Paragraph({}),
                            findings.inner_title === 'Cyber Security Indicators' &&
                            new Paragraph({
                                children: [
                                    new TextRun({ text: 'Notes:', bold: true, break: 1, underline: true }),
                                    new TextRun({ text: '', break: 1 }),
                                    new TextRun({ text: 'Cyber Ratings ', bold: true }),
                                    new TextRun({ text: '(if applicable): High: <651; Medium: 651-750; Low: 751-900', break: 1 }),
                                ],
                            }),
                            new Paragraph({}),
                            findings.inner_title === 'Financial Indicators' && new Paragraph({}),
                        ],
                    }),
                ],
            }),
        ],
    }),
    new Paragraph({}),
];

// ─── tryParseJson ─────────────────────────────────────────────────────────────
function tryParseJson(s) {
    if (!s || !['[', '{'].includes(String(s).trim()[0])) return null;
    try {
        return JSON.parse(
            String(s)
                .replace(/&quot;|&#34;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>'),
        );
    } catch {
        return null;
    }
}

const getUrlFromText = (text, links, highlight = false) => {
    const match = text.match(/(https?:\/\/[^\s]+)/);
    let url = match ? match[0] : null;
    let textAfterUrl = '';
    if (url) textAfterUrl = text.replace(/.*https?:\/\/[^\s]+/, '').trim();
    if (url && url.includes('?')) url = null;
    if (!url) return null;

    return new ExternalHyperlink({
        children: [
            new TextRun({ text: '', break: 1 }),
            new TextRun({ text: 'Source:', bold: true, highlight: highlight ? 'yellow' : undefined }),
            new TextRun({ text: '', break: 1 }),
            new TextRun({ text: links.find((l) => l.url === url)?.title ?? 'Source Link', style: 'Hyperlink', highlight: highlight ? 'yellow' : undefined }),
            new TextRun({ text: ` ${textAfterUrl}`, highlight: highlight ? 'yellow' : undefined }),
            new TextRun({ text: '', break: 1 }),
        ],
        link: url,
    });
};

function renderKpiDetails(kpi_details) {
    const normalized = kpi_details.replace(
        /<p\b[^>]*>([\s\S]*?)<\/p>/gi,
        (_, inner) => `<p>${inner.replace(/\s*\n+\s*/g, 'dddd')}</p>`,
    );

    return normalized.split(/\n+/).flatMap((line) => {
        if (!line.trim()) return [];
        const children = [];
        let last = 0;
        const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
        let m;

        while ((m = re.exec(line)) !== null) {
            if (m.index > last) children.push(new TextRun({ text: line.slice(last, m.index) }));
            const parts = m[1].split('dddd');
            parts.forEach((hlLine, idx) => {
                const t = hlLine.trim();
                const link = getUrlFromText(t, links || [], true);
                if (link) children.push(link);
                else children.push(new TextRun({ text: t, highlight: 'yellow' }));
                if (idx < parts.length - 1) children.push(new TextRun({ text: '', break: 1 }));
            });
            last = re.lastIndex;
        }

        const t = line.slice(last);
        const link = getUrlFromText(t, links || []);
        if (link) children.push(link);
        else children.push(new TextRun({ text: t }));
        children.push(new TextRun({ text: '', break: 1 }));
        return [new Paragraph({ children })];
    });
}

// ─── createFindingsTable ──────────────────────────────────────────────────────
// Renders a KPI block. If kpi_details is JSON → Factor/Value table.
// Otherwise → plain text / URL paragraphs.
const createFindingsTable = (findings) => {
    return [
        new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
                new TableRow({
                    height: { rule: 'atLeast', value: 500 },
                    children: [
                        createCell('Name & Relation', { background: 'f2f2f2', alignment: 'left', bold: true, width: { size: 20, type: WidthType.PERCENTAGE } }),
                        createCell(findings.kpi_definition, { background: 'ffffff', alignment: 'center', bold: false, width: { size: 50, type: WidthType.PERCENTAGE } }),
                        createCell('Rating', { width: { size: 15, type: WidthType.PERCENTAGE } }),
                        createCell(findings.kpi_rating, { background: 'ffffff', alignment: 'center', bold: false, width: { size: 15, type: WidthType.PERCENTAGE } }),
                    ],
                }),
                new TableRow({
                    height: { rule: 'atLeast', value: 500 },
                    children: [createCell('Findings', { columnSpan: 4, alignment: 'left', background: 'f2f2f2', bold: true })],
                }),
                new TableRow({
                    height: { rule: 'atLeast', value: 500 },
                    children: [
                        new TableCell({
                            shading: { fill: 'ffffff' },
                            columnSpan: 4,
                            children: (() => {
                                const parsed = tryParseJson(findings.kpi_details);
                                if (parsed && Array.isArray(parsed) && parsed.length > 0) {
                                    const cols = Object.keys(parsed[0]);
                                    const colPct = Math.floor(100 / cols.length);
                                    const lastColPct = 100 - colPct * (cols.length - 1);
                                    const toTitle = (k) => String(k).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

                                    return [
                                        new Paragraph({}),
                                        new Table({
                                            width: { size: 100, type: WidthType.PERCENTAGE },
                                            rows: [
                                                new TableRow({
                                                    children: cols.map((c, i) =>
                                                        new TableCell({
                                                            width: { size: i < cols.length - 1 ? colPct : lastColPct, type: WidthType.PERCENTAGE },
                                                            shading: { fill: 'f2f2f2' },
                                                            borders,
                                                            children: [new Paragraph({ children: [new TextRun({ text: toTitle(c), bold: true, size: 18 })] })],
                                                        }),
                                                    ),
                                                }),
                                                ...parsed.map((row, ri) =>
                                                    new TableRow({
                                                        children: cols.map((c, ci) =>
                                                            new TableCell({
                                                                width: { size: ci < cols.length - 1 ? colPct : lastColPct, type: WidthType.PERCENTAGE },
                                                                shading: { fill: ri % 2 === 0 ? 'F9F9F9' : 'ffffff' },
                                                                borders,
                                                                children: [new Paragraph({ children: [new TextRun({ text: String(row[c] ?? '—'), size: 18 })] })],
                                                            }),
                                                        ),
                                                    }),
                                                ),
                                            ],
                                        }),
                                        new Paragraph({}),
                                        !kpi_codes.includes(findings.kpi_code) &&
                                        new Paragraph({
                                            children: [
                                                new TextRun({ text: '', break: 1 }),
                                                new TextRun({ text: 'Source:', bold: true }),
                                                new TextRun({ text: ' EY Network Alliance Databases' }),
                                                new TextRun({ text: '', break: 1 }),
                                            ],
                                        }),
                                        new Paragraph({}),
                                    ].filter(Boolean);
                                }

                                // Plain text / URL path
                                return [
                                    new Paragraph({}),
                                    ...renderKpiDetails(findings.kpi_details),
                                    new Paragraph({}),
                                    !kpi_codes.includes(findings.kpi_code) &&
                                    new Paragraph({
                                        children: [
                                            new TextRun({ text: '', break: 1 }),
                                            new TextRun({ text: 'Source:', bold: true }),
                                            new TextRun({ text: ' EY Network Alliance Databases' }),
                                            new TextRun({ text: '', break: 1 }),
                                        ],
                                    }),
                                    new Paragraph({}),
                                ].filter(Boolean);
                            })(),
                        }),
                    ],
                }),
            ],
        }),
        new Paragraph({}),
    ];
};

const annexureTable = (info) => [
    new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
            new TableRow({
                height: { rule: 'atLeast', value: 500 },
                children: [
                    createCell(info.title, { background: 'f2f2f2', alignment: 'left', bold: true, width: { size: 100, type: WidthType.PERCENTAGE } }),
                ],
            }),
            new TableRow({
                height: { rule: 'atLeast', value: 500 },
                children: [
                    new TableCell({
                        children: [
                            ...info.contents.trim().split(/\n+/).map((text) =>
                                new Paragraph({ children: [new TextRun({ text, break: 1 })] }),
                            ),
                            new Paragraph({}),
                        ],
                        shading: { fill: 'ffffff' },
                        columnSpan: 4,
                    }),
                ],
            }),
        ],
    }),
    new Paragraph({}),
];

// ─── processKpiDetails ────────────────────────────────────────────────────────
// Extracts source URLs from plain-text kpi_details only.
// JSON payloads are skipped — their URLs are data values, not source links.
const processKpiDetails = (findings) => {
    const raw = findings.kpi_details?.trim();
    if (!raw) return [];
    // Skip JSON — fetching URLs inside JSON fields causes ENOTFOUND errors
    if (raw.startsWith('[') || raw.startsWith('{')) return [];
    return raw
        .split(/\n+/)
        .map((text) => text.match(/(https?:\/\/[^\s]+)/)?.[0] ?? null)
        .filter(Boolean);
};

// ─── getPageTitle ─────────────────────────────────────────────────────────────
// 5 s timeout, silent fallback — never throws or logs errors.
const getPageTitle = async (url) => {
    try {
        const response = await axios.get(url, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const $ = cheerio.load(response.data);
        return (
            $('meta[property="og:title"]').attr('content')?.trim() ||
            $('title').text().trim() ||
            'Source Link'
        );
    } catch {
        return 'Source Link';
    }
};

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN EXPORT
// ═════════════════════════════════════════════════════════════════════════════
export const generateReport = async (payload) => {
    let data;
    try {
        let urls = [];
        links = [];
        const disableRegulatoryAndLegal = !!payload['disable-regulator-and-legal'];

        data = {
            ...payload,
            // Normalise corporate_ownership_findings → sown_findings
            sown_findings: payload.sown_findings ?? payload.corporate_ownership_findings ?? false,

            // ── riskData ─────────────────────────────────────────────────────────
            riskData: [
                { area: 'Entity Existence', rating: payload.entity_existence_rating ?? 'No Alerts' },
                { area: 'Sanctions', rating: payload.sanctions_rating },
                { area: 'Anti-Bribery and Anti-Corruption', rating: payload.anti_rating },
                { area: 'Government Ownership and Political Affiliations', rating: payload.gov_rating },
                { area: 'Financial Indicators', rating: payload.financial_rating },
                { area: 'Other Adverse Media', rating: payload.adv_rating },
                { area: 'Additional Indicators', rating: payload.additional_indicators_rating },
                { area: 'Regulatory & Legal', rating: payload.regulatory_and_legal_rating },
            ],

            // ── riskAreas (summary bullet lists) ─────────────────────────────────
            riskAreas: {
                entityExistence: payload.entity_existence_summary ?? [],
                sanctions: payload.sanctions_summary,
                antiBriberyAndAntiCorruption: payload.anti_summary,
                governmentOwnershipAndPoliticalAffiliations: payload.gov_summary,
                financialIndicators: payload.financial_summary,
                otherAdverseMedia: payload.adv_summary,
                additional_indicators: payload.additional_indicators_summary,
                ...(!disableRegulatoryAndLegal && { regulatoryAndLegal: payload.ral_summary }),
            },

            // ── Structured findings objects ───────────────────────────────────────
            cyberSecurity_findings: {
                title: `${payload.name} (Self)`,
                rating: payload.cyber_rating,
                inner_title: 'Cyber Security Indicators',
                // ✅ CYB3A excluded from cyber inner table
                data: payload.additional_indicators_findings && payload.additional_indicators_data?.length
                    ? payload.additional_indicators_data.filter(
                        (item) => item.kpi_area === 'CYB' && item.kpi_code !== 'CYB3A',
                    )
                    : [],
            },
            financial_findings: {
                title: `${payload.name} (Self)`,
                rating: payload.financial_rating,
                inner_title: 'Financial Indicators',
                data: payload.financial_findings ? payload.financial_data : [],
            },
            esg_findings: {
                title: `${payload.name} (Self)`,
                rating: payload.esg_rating,
                inner_title: 'ESG Indicators',
                data: payload.additional_indicators_findings && payload.additional_indicators_data?.length
                    ? payload.additional_indicators_data.filter((item) => item.kpi_area === 'ESG')
                    : [],
            },
            // WEB section remains WEB; CYB3A should come in payload as WEB kpi_area if needed there
            web_findings: {
                data: payload.additional_indicators_findings && payload.additional_indicators_data?.length
                    ? payload.additional_indicators_data.filter((item) => item.kpi_area === 'WEB')
                    : [],
            },
        };

        // ── Pre-fetch source URL titles (plain-text KPIs only) ──────────────────
        const processUrlProps = [
            'sape_data', 'reg_data', 'leg_data', 'bribery_data',
            'sown_data', 'adv_data', 'backruptcy_data',
            'entity_existence_data',
        ];

        for (const prop of processUrlProps) {
            if (data[prop]) {
                data[prop].forEach((item) => { urls = [...urls, ...processKpiDetails(item)]; });
            }
        }

        links = await Promise.all(
            urls.map(async (url) => ({ url, title: await getPageTitle(url) })),
        );

        if (disableRegulatoryAndLegal) {
            template = 'aramco_template-no-regulatory-legal.docx';
            data.riskData.pop();
        }

        const TEMPLATE_PATH = `src/template/${template}`;
        const date = new Date();
        const day = date.getDate();
        const month = date.toLocaleString('en-US', { month: 'long' });
        const year = date.getFullYear();
        const ordinalSuffix = getOrdinalSuffix(day);

        const doc = await patchDocument({
            outputType: 'nodebuffer',
            data: fs.readFileSync(TEMPLATE_PATH),
            patches: {
                vendorId: createTextRun({ text: `Supplier ID: ${data.external_vendor_id}` }),
                uploadedName: createTextRun({ text: `[${data.uploaded_name}]` }),
                title: createTextRun({ text: data.name }),
                created_date: {
                    type: PatchType.PARAGRAPH,
                    children: [
                        new TextRun({ text: `${day}` }),
                        new TextRun({ text: ordinalSuffix, superScript: true }),
                        new TextRun({ text: ` ${month} ${year}` }),
                    ],
                },

                company_name: createTextRun({ text: data.name }),
                company_location: createTextRun({ text: data.location }),
                company_address: createTextRun({ text: data.address }),
                company_uploaded_name: createTextRun({ text: data.uploaded_name }),
                company_external_vendor_id: createTextRun({ text: data.external_vendor_id }),
                company_website: {
                    type: PatchType.DOCUMENT,
                    children: [
                        new Paragraph({
                            children: [
                                isValidURL(data.website)
                                    ? new ExternalHyperlink({
                                        children: [new TextRun({ text: data.website, style: 'Hyperlink' })],
                                        link: formatHttpsURL(data.website),
                                    })
                                    : new TextRun({ text: data.website }),
                            ],
                        }),
                    ],
                },
                company_active_status: createTextRun({ text: data.active_status }),
                company_operation_type: createTextRun({ text: data.operation_type }),
                company_legal_status: createTextRun({ text: data.legal_status }),
                company_national_identifier: createTextRun({ text: data.national_id }),
                company_alias: {
                    type: PatchType.DOCUMENT,
                    children: [
                        new Paragraph({}),
                        ...data.alias.split(/\n+/).map((text) =>
                            new Paragraph({ children: [new TextRun({ text, break: 1 })] }),
                        ),
                        new Paragraph({}),
                    ],
                },
                company_incorporation_date: createTextRun({ text: data.incorporation_date }),
                company_subsidiaries: createTextRun({ text: data.subsidiaries }),
                company_corporate_group: createTextRun({ text: data.corporate_group }),
                shareholders: {
                    type: PatchType.DOCUMENT,
                    children: [
                        new Paragraph({}),
                        ...data.shareholders.split('\n').map((s) => new Paragraph(s)),
                        new Paragraph({}),
                    ],
                },
                key_executives: {
                    type: PatchType.DOCUMENT,
                    children: [
                        new Paragraph({}),
                        ...data.key_exec.split('\n').map((e) => new Paragraph(e)),
                        new Paragraph({}),
                    ],
                },
                company_revenue: createTextRun({ text: data.revenue }),
                company_employee: createTextRun({ text: data.employee_count }),

                overall_rating: {
                    type: PatchType.DOCUMENT,
                    children: [
                        new Table({
                            columnWidths: [8000, 4000],
                            width: { size: 70, type: WidthType.PERCENTAGE },
                            alignment: 'center',
                            rows: [
                                new TableRow({
                                    height: { rule: 'atLeast', value: 500 },
                                    children: [
                                        new TableCell({
                                            verticalAlign: 'center',
                                            children: [
                                                new Paragraph({
                                                    alignment: 'center',
                                                    children: [new TextRun({ text: 'OVERALL RISK RATING', bold: true, size: 28 })],
                                                }),
                                            ],
                                            borders,
                                        }),
                                        new TableCell({
                                            verticalAlign: 'center',
                                            children: [
                                                new Paragraph({
                                                    alignment: 'center',
                                                    children: [
                                                        new TextRun({
                                                            text: data.risk_level,
                                                            bold: true,
                                                            size: 28,
                                                            color: getRiskColor(data.risk_level).color,
                                                            allCaps: true,
                                                        }),
                                                    ],
                                                }),
                                            ],
                                            borders,
                                            shading: { fill: getRiskColor(data.risk_level).background },
                                        }),
                                    ],
                                }),
                            ],
                        }),
                    ],
                },

                overall_summary: {
                    type: PatchType.DOCUMENT,
                    children: data.summary_of_findings
                        .split(/\n+/)
                        .map((text) => new Paragraph({ children: [new TextRun({ text, break: 1 })] })),
                },

                risk_areas: {
                    type: PatchType.DOCUMENT,
                    children: [
                        new Table({
                            width: { size: 75, type: WidthType.PERCENTAGE },
                            alignment: 'left',
                            borders,
                            rows: [
                                new TableRow({
                                    height: { rule: 'atLeast', value: 500 },
                                    children: [
                                        new TableCell({
                                            verticalAlign: 'center',
                                            width: { size: 80, type: WidthType.PERCENTAGE },
                                            children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: 'Risk Areas', bold: true, color: 'ffffff' })] })],
                                            borders,
                                            shading: { fill: '595959' },
                                        }),
                                        new TableCell({
                                            verticalAlign: 'center',
                                            children: [new Paragraph({ alignment: 'center', children: [new TextRun({ text: 'Risk Rating', color: 'ffffff', bold: true })] })],
                                            borders,
                                            shading: { fill: '595959' },
                                        }),
                                    ],
                                }),
                                ...data.riskData.map((risk) =>
                                    new TableRow({
                                        height: { rule: 'atLeast', value: 500 },
                                        children: [
                                            new TableCell({
                                                verticalAlign: 'center',
                                                children: [new Paragraph({ children: [new TextRun({ text: risk.area, font: 'EYInterstate Light' })] })],
                                                borders,
                                            }),
                                            new TableCell({
                                                verticalAlign: 'center',
                                                children: [
                                                    new Paragraph({
                                                        alignment: AlignmentType.CENTER,
                                                        children: [new TextRun({ text: risk.rating, color: getRiskColor(risk.rating).color, font: 'EYInterstate Light', size: 20 })],
                                                    }),
                                                ],
                                                shading: { fill: getRiskColor(risk.rating).background },
                                                borders,
                                            }),
                                        ],
                                    }),
                                ),
                            ],
                        }),
                    ],
                },

                riskAreas_antiBriberyAndAntiCorruption: {
                    type: PatchType.DOCUMENT,
                    children: data.anti_summary.map((text) =>
                        new Paragraph({
                            spacing: { before: 300, after: 300 },
                            bullet: { level: 0 },
                            children: [
                                ...text.trim().split(/\n+/).map((line, i) => new TextRun({ text: line, break: i === 0 ? 0 : 1 })),
                                new TextRun({ break: 1 }),
                            ],
                        }),
                    ),
                },

                ...Object.entries(data.riskAreas).reduce(
                    (acc, [key, value]) => ({
                        ...acc,
                        [`riskAreas_${key}`]: {
                            type: PatchType.DOCUMENT,
                            children: (Array.isArray(value) ? value : []).map((text) =>
                                new Paragraph({
                                    spacing: { before: 300, after: 300 },
                                    bullet: { level: 0 },
                                    children: [
                                        ...String(text).trim().split(/\n+/).map((line, i) => new TextRun({ text: line, break: i === 0 ? 0 : 1 })),
                                        new TextRun({ break: 1 }),
                                    ],
                                }),
                            ),
                        },
                    }),
                    {},
                ),

                annexure: {
                    type: PatchType.DOCUMENT,
                    children: data.annexure.length > 0
                        ? data.annexure.map(annexureTable).flat()
                        : noAnnexure(),
                },

                a_rating: highlightRating(data.riskData[0].rating),
                b_rating: highlightRating(data.riskData[1].rating),
                c_rating: highlightRating(data.riskData[2].rating),
                d_rating: highlightRating(data.riskData[3].rating),
                e_rating: highlightRating(data.riskData[4].rating),
                f_rating: highlightRating(data.riskData[5].rating),
                h_rating: highlightRating(data.riskData[6].rating),

                ...(!disableRegulatoryAndLegal && {
                    g_rating: highlightRating(data.riskData[7].rating),
                    regularity_findings: {
                        type: PatchType.DOCUMENT,
                        children: data.reg_findings
                            ? data.reg_data.map(createFindingsTable).flat()
                            : createNoHitsTable('REGULATORY'),
                    },
                    legal_findings: {
                        type: PatchType.DOCUMENT,
                        children: data.bankruptcy_findings
                            ? data.leg_data.map(createFindingsTable).flat()
                            : createNoHitsTable('LEGAL'),
                    },
                }),

                page_break: {
                    type: PatchType.DOCUMENT,
                    children: [new Paragraph({ pageBreakBefore: true })],
                },

                entity_existence_findings: {
                    type: PatchType.DOCUMENT,
                    children: [
                        ...(payload.entity_existence_findings && data.entity_existence_data?.length > 0
                            ? data.entity_existence_data.map(createFindingsTable).flat()
                            : createNoHitsTable('ENTITY EXISTENCE')),
                        ...(await createAddressValidationTable(data.google_image_name)),
                    ],
                },

                sanctions_findings: {
                    type: PatchType.DOCUMENT,
                    children: data.sanctions_findings
                        ? data.sape_data.map(createFindingsTable).flat()
                        : createNoHitsTable('SANCTIONS'),
                },

                antiBribery_findings: {
                    type: PatchType.DOCUMENT,
                    children: data.bribery_findings
                        ? data.bribery_data.map(createFindingsTable).flat()
                        : createNoHitsTable('ANTI-BRIBERY AND ANTI-CORRUPTION'),
                },

                government_ownership_and_political_affiliations_findings: {
                    type: PatchType.DOCUMENT,
                    children: data.sown_findings
                        ? data.sown_data.map(createFindingsTable).flat()
                        : createNoHitsTable('GOVERNMENT OWNERSHIP AND POLITICAL AFFILIATIONS'),
                },

                financial_indicators_findings: {
                    type: PatchType.DOCUMENT,
                    children: data.financial_findings.data.length > 0
                        ? createFindingsInnerTable(data.financial_findings)
                        : createNoHitsTable('FINANCIALS'),
                },

                bankruptcy_findings: {
                    type: PatchType.DOCUMENT,
                    children: data.bankruptcy_findings
                        ? data.backruptcy_data.map(createFindingsTable).flat()
                        : createNoHitsTable('BANKRUPTCY'),
                },

                other_adverse_media_findings: {
                    type: PatchType.DOCUMENT,
                    children: data.adv_findings
                        ? data.adv_data.map(createFindingsTable).flat()
                        : createNoHitsTable('OTHER ADVERSE MEDIA'),
                },

                // ✅ WEB findings render as Domain Validation-style KPI tables
                web_findings: {
                    type: PatchType.DOCUMENT,
                    children: (data.web_findings.data || []).length > 0
                        ? data.web_findings.data.map(createFindingsTable).flat()
                        : [],
                },

                cyberSecurity_findings: {
                    type: PatchType.DOCUMENT,
                    children: data.cyberSecurity_findings.data.length > 0
                        ? createFindingsInnerTable(data.cyberSecurity_findings)
                        : createNoHitsTable('CYBER SECURITY'),
                },

                esg_findings: {
                    type: PatchType.DOCUMENT,
                    children: data.esg_findings.data.length > 0
                        ? createFindingsInnerTable(data.esg_findings)
                        : createNoHitsTable('ESG'),
                },
            },
        });

        const fileName = `${data.name}`;
        const docxPath = `src/${fileName}.docx`;

        fs.writeFileSync(docxPath, doc);

        await Promise.all([
            uploadToAzure(docxPath, `${data.session_id}/${data.ens_id}/${fileName}.docx`, data.session_id),
        ]);

        await Promise.all([fs.promises.unlink(docxPath)]);

        await uploadBufferToAzure(
            doc,
            `${data.session_id}/${data.ens_id}/${data.name}.docx`,
            data.session_id,
        );
    } catch (error) {
        console.error('Error generating report:', error);
        throw new Error('Report generation failed');
    }
};