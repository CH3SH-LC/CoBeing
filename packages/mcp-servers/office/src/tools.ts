/**
 * Office MCP 工具定义 — Word/Excel/PowerPoint 文档处理
 *
 * 使用技术栈:
 *   - docx: Word 文档创建与编辑
 *   - exceljs: Excel 电子表格读写
 *   - pptxgenjs: PowerPoint 演示文稿创建
 *
 * 所有文件操作在沙箱模式下（无文件系统依赖）返回模拟数据。
 */
import { createLogger } from "@cobeing/shared";

const log = createLogger("office-tools");

interface Tool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  execute: (params: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
}

// ================================================================
//  沙箱模式检测
// ================================================================

function isSandbox(): boolean {
  return process.env.OFFICE_SANDBOX === "true";
}

function checkSandbox(): boolean {
  if (isSandbox()) return true;
  try {
    // 检查依赖库是否可用（延迟加载）
    return false;
  } catch {
    return true;
  }
}

// ================================================================
//  工具定义
// ================================================================

export function makeTools(): Tool[] {
  return [
    // ================================================================
    //  Word 文档
    // ================================================================

    {
      name: "office_create_doc",
      description: `创建新的 Word 文档（.docx）。
可选的初始内容以数组形式传入，每项为 { text, options? }。
options 支持: bold, italic, size, heading ("Heading1"/"Heading2"/...), bullet。
文档不会立即写入磁盘，需调用 office_doc_save 保存。`,
      inputSchema: {
        type: "object",
        properties: {
          initialContent: {
            type: "array",
            description: "初始段落内容（可选）",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "段落文本" },
                heading: { type: "string", description: "标题级别: Heading1/Heading2/Heading3" },
                bold: { type: "boolean", description: "是否加粗" },
                italic: { type: "boolean", description: "是否斜体" },
                size: { type: "number", description: "字号（磅）" },
                bullet: { type: "boolean", description: "是否列表项" },
                alignment: { type: "string", description: "对齐: left/center/right" },
              },
            },
          },
        },
      },
      async execute(params) {
        if (isSandbox()) {
          return { content: `[沙箱] Word 文档已创建（含 ${(params.initialContent as any[])?.length || 0} 个初始段落）` };
        }
        try {
          const { createDocx } = await import("./office-engine.js");
          const docRef = await createDocx(params.initialContent as any[]);
          return { content: `Word 文档已创建（ID: ${docRef.id}，当前 ${docRef.paragraphCount} 个段落）` };
        } catch (err: any) {
          return { content: `创建失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_doc_add_content",
      description: `向已创建的 Word 文档添加内容。
docId 从 office_create_doc 的返回值获取。
content 数组支持段落、标题、表格。`,
      inputSchema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "文档 ID（从 office_create_doc 返回）" },
          content: {
            type: "array",
            description: "要添加的内容项数组",
            items: {
              type: "object",
              properties: {
                type: { type: "string", description: "内容类型: paragraph / table / pageBreak" },
                text: { type: "string", description: "段落文本（type=paragraph 时必填）" },
                heading: { type: "string", description: "标题级别: Heading1/Heading2/Heading3" },
                bold: { type: "boolean" },
                italic: { type: "boolean" },
                bullet: { type: "boolean" },
                alignment: { type: "string", description: "left/center/right" },
                rows: { type: "number", description: "表格行数（type=table 时必填）" },
                cols: { type: "number", description: "表格列数（type=table 时必填）" },
                data: { type: "array", description: "表格数据: 二维数组 [[行1], [行2]]" },
              },
            },
          },
        },
        required: ["docId"],
      },
      async execute(params) {
        if (isSandbox()) {
          return { content: `[沙箱] 已添加 ${(params.content as any[])?.length || 0} 项内容到文档 ${params.docId}` };
        }
        try {
          const { addContent } = await import("./office-engine.js");
          const result = await addContent(params.docId as string, params.content as any[]);
          return { content: `已添加 ${result} 项内容到文档` };
        } catch (err: any) {
          return { content: `添加失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_doc_save",
      description: `将 Word 文档保存到文件。
docId 从 office_create_doc 的返回值获取。
filePath 为绝对路径或相对于工作目录的路径。`,
      inputSchema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "文档 ID" },
          filePath: { type: "string", description: "保存路径，如 ./output/report.docx 或 /absolute/path.docx" },
        },
        required: ["docId", "filePath"],
      },
      async execute(params) {
        const { docId, filePath } = params as { docId: string; filePath: string };
        if (!filePath) return { content: "错误: 缺少 filePath", isError: true };
        if (!filePath.endsWith(".docx")) return { content: "错误: 文件名必须以 .docx 结尾", isError: true };
        if (isSandbox()) {
          return { content: `[沙箱] 文档已保存到 ${filePath}` };
        }
        try {
          const { saveDocx } = await import("./office-engine.js");
          const path = await saveDocx(docId, filePath);
          return { content: `Word 文档已保存到 ${path}` };
        } catch (err: any) {
          return { content: `保存失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  Excel 电子表格
    // ================================================================

    {
      name: "office_create_excel",
      description: `创建新的 Excel 工作簿（.xlsx）。
可选的初始工作表和数据。`,
      inputSchema: {
        type: "object",
        properties: {
          sheetName: { type: "string", description: "初始工作表名称，默认 'Sheet1'" },
          initialData: {
            type: "array",
            description: "初始数据: 二维数组，第一行作文本表头",
            items: { type: "array", items: { type: ["string", "number", "boolean"] } },
          },
        },
      },
      async execute(params) {
        if (isSandbox()) {
          return { content: `[沙箱] Excel 工作簿已创建（工作表: ${params.sheetName || "Sheet1"}）` };
        }
        try {
          const { createExcel } = await import("./office-engine.js");
          const ref = await createExcel(params.sheetName as string, params.initialData as any[][]);
          return { content: `Excel 工作簿已创建（ID: ${ref.id}，工作表: ${ref.sheetCount}）` };
        } catch (err: any) {
          return { content: `创建失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_excel_write_data",
      description: `向 Excel 工作簿写入数据。
支持写入单元格区域，自动检测表头。
excelId 从 office_create_excel 的返回值获取。`,
      inputSchema: {
        type: "object",
        properties: {
          excelId: { type: "string", description: "Excel 工作簿 ID" },
          sheetName: { type: "string", description: "工作表名称（默认当前活动工作表）" },
          data: {
            type: "array",
            description: "要写入的数据: 二维数组 [[表头1,表头2],[值1,值2]]",
            items: { type: "array" },
          },
          startCell: { type: "string", description: "起始单元格，如 'A1'（默认 A1）" },
        },
        required: ["excelId", "data"],
      },
      async execute(params) {
        const { excelId, data } = params as { excelId: string; data: any[][]; sheetName?: string; startCell?: string };
        if (!data || !Array.isArray(data)) return { content: "错误: data 必须是二维数组", isError: true };
        if (isSandbox()) {
          return { content: `[沙箱] 已写入 ${data.length} 行 × ${Math.max(...data.map(r => (r as any[]).length))} 列数据` };
        }
        try {
          const { writeExcelData } = await import("./office-engine.js");
          await writeExcelData(excelId, data, params.sheetName as string, params.startCell as string);
          return { content: `已写入 ${data.length} 行数据` };
        } catch (err: any) {
          return { content: `写入失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_excel_add_sheet",
      description: `向 Excel 工作簿添加新工作表。`,
      inputSchema: {
        type: "object",
        properties: {
          excelId: { type: "string", description: "Excel 工作簿 ID" },
          sheetName: { type: "string", description: "新工作表名称" },
          data: {
            type: "array",
            description: "初始数据（可选）: 二维数组",
            items: { type: "array" },
          },
        },
        required: ["excelId", "sheetName"],
      },
      async execute(params) {
        const { excelId, sheetName, data } = params as { excelId: string; sheetName: string; data?: any[][] };
        if (!sheetName) return { content: "错误: 缺少 sheetName", isError: true };
        if (isSandbox()) {
          return { content: `[沙箱] 已添加工作表 "${sheetName}"` };
        }
        try {
          const { addExcelSheet } = await import("./office-engine.js");
          await addExcelSheet(excelId, sheetName, data);
          return { content: `已添加工作表 "${sheetName}"` };
        } catch (err: any) {
          return { content: `添加失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_excel_save",
      description: `将 Excel 工作簿保存到文件。
excelId 从 office_create_excel 的返回值获取。
filePath 为保存路径，需以 .xlsx 结尾。`,
      inputSchema: {
        type: "object",
        properties: {
          excelId: { type: "string", description: "Excel 工作簿 ID" },
          filePath: { type: "string", description: "保存路径，如 ./output/data.xlsx" },
        },
        required: ["excelId", "filePath"],
      },
      async execute(params) {
        const { excelId, filePath } = params as { excelId: string; filePath: string };
        if (!filePath) return { content: "错误: 缺少 filePath", isError: true };
        if (!filePath.endsWith(".xlsx")) return { content: "错误: 文件名必须以 .xlsx 结尾", isError: true };
        if (isSandbox()) {
          return { content: `[沙箱] 工作簿已保存到 ${filePath}` };
        }
        try {
          const { saveExcel } = await import("./office-engine.js");
          const path = await saveExcel(excelId, filePath);
          return { content: `Excel 工作簿已保存到 ${path}` };
        } catch (err: any) {
          return { content: `保存失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  PowerPoint 演示文稿
    // ================================================================

    {
      name: "office_create_ppt",
      description: `创建新的 PowerPoint 演示文稿（.pptx）。
可选的初始幻灯片内容。`,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "演示文稿标题" },
          slides: {
            type: "array",
            description: "初始幻灯片（可选）",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "幻灯片标题" },
                content: { type: "string", description: "正文内容（支持 \\n 换行）" },
                layout: { type: "string", description: "布局: title/content/twoColumn/blank，默认 content" },
              },
            },
          },
        },
      },
      async execute(params) {
        if (isSandbox()) {
          return { content: `[沙箱] 演示文稿已创建（${(params.slides as any[])?.length || 0} 张初始幻灯片）` };
        }
        try {
          const { createPpt } = await import("./office-engine.js");
          const ref = await createPpt(params.title as string, params.slides as any[]);
          return { content: `演示文稿已创建（ID: ${ref.id}，${ref.slideCount} 张幻灯片）` };
        } catch (err: any) {
          return { content: `创建失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_ppt_add_slide",
      description: `向演示文稿添加幻灯片。
pptId 从 office_create_ppt 的返回值获取。`,
      inputSchema: {
        type: "object",
        properties: {
          pptId: { type: "string", description: "演示文稿 ID" },
          title: { type: "string", description: "幻灯片标题" },
          content: { type: "string", description: "正文内容（支持 \\n 换行）" },
          layout: { type: "string", description: "布局: title/content/twoColumn/blank" },
          imageUrl: { type: "string", description: "图片 URL（可选）" },
        },
        required: ["pptId", "title"],
      },
      async execute(params) {
        const { pptId, title, content, layout, imageUrl } = params as any;
        if (!title) return { content: "错误: 缺少 title", isError: true };
        if (isSandbox()) {
          return { content: `[沙箱] 已添加幻灯片 "${title}"` };
        }
        try {
          const { addPptSlide } = await import("./office-engine.js");
          await addPptSlide(pptId, title, content, layout, imageUrl);
          return { content: `已添加幻灯片 "${title}"` };
        } catch (err: any) {
          return { content: `添加失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_ppt_save",
      description: `将演示文稿保存到文件。
pptId 从 office_create_ppt 的返回值获取。
filePath 需以 .pptx 结尾。`,
      inputSchema: {
        type: "object",
        properties: {
          pptId: { type: "string", description: "演示文稿 ID" },
          filePath: { type: "string", description: "保存路径，如 ./output/presentation.pptx" },
        },
        required: ["pptId", "filePath"],
      },
      async execute(params) {
        const { pptId, filePath } = params as { pptId: string; filePath: string };
        if (!filePath) return { content: "错误: 缺少 filePath", isError: true };
        if (!filePath.endsWith(".pptx")) return { content: "错误: 文件名必须以 .pptx 结尾", isError: true };
        if (isSandbox()) {
          return { content: `[沙箱] 演示文稿已保存到 ${filePath}` };
        }
        try {
          const { savePpt } = await import("./office-engine.js");
          const path = await savePpt(pptId, filePath);
          return { content: `演示文稿已保存到 ${path}` };
        } catch (err: any) {
          return { content: `保存失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  状态工具
    // ================================================================

    {
      name: "office_status",
      description: "获取 Office MCP 服务器的状态和可用功能。",
      inputSchema: { type: "object", properties: {} },
      async execute() {
        const mode = isSandbox() ? "沙箱模式" : "在线模式";
        return {
          content: [
            `Office MCP 服务器状态: ${mode}`,
            "",
            "支持的文件类型:",
            "- Word (.docx): 创建文档/添加段落/表格/图片/保存",
            "- Excel (.xlsx): 创建工作簿/读写数据/添加工作表/保存",
            "- PowerPoint (.pptx): 创建演示文稿/添加幻灯片/保存",
            "",
            "使用方法:",
            "1. 调用对应的 create 工具创建新文件（返回文件 ID）",
            "2. 用 add/write 工具添加内容",
            "3. 用 save 工具保存到磁盘",
            "",
            `环境变量 OFFICE_SANDBOX=true 可启用沙箱模式（跳过实际文件写入）`,
          ].join("\n"),
        };
      },
    },

    // ================================================================
    //  高级 Word 工具
    // ================================================================

    {
      name: "office_doc_set_header_footer",
      description: `设置 Word 文档的页眉和页脚。
支持在页眉/页脚中放置文本。在保存文档时生效。`,
      inputSchema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "文档 ID" },
          header: { type: "string", description: "页眉文本（可选）" },
          footer: { type: "string", description: "页脚文本（可选）" },
        },
        required: ["docId"],
      },
      async execute(params) {
        const { docId, header, footer } = params as any;
        if (!docId) return { content: "错误: 缺少 docId", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已设置页眉/页脚` };
        try {
          const { setDocHeaderFooter } = await import("./office-engine.js");
          await setDocHeaderFooter(docId, header, footer);
          return { content: `已${header ? "设置页眉" : ""}${header && footer ? "和" : ""}${footer ? "设置页脚" : ""}` };
        } catch (err: any) {
          return { content: `设置失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_doc_add_image",
      description: `向 Word 文档添加图片。
支持 URL 图片和本地文件路径。可选标题和尺寸。`,
      inputSchema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "文档 ID" },
          imageUrl: { type: "string", description: "图片 URL 或本地路径" },
          width: { type: "number", description: "图片宽度像素（默认 400）" },
          height: { type: "number", description: "图片高度像素（默认 300）" },
          caption: { type: "string", description: "图片标题（可选）" },
        },
        required: ["docId", "imageUrl"],
      },
      async execute(params) {
        const { docId, imageUrl, width, height, caption } = params as any;
        if (!docId) return { content: "错误: 缺少 docId", isError: true };
        if (!imageUrl) return { content: "错误: 缺少图片 URL", isError: true };
        if (isSandbox()) return { content: `[沙箱] 图片已添加到文档` };
        try {
          const { addDocImage } = await import("./office-engine.js");
          await addDocImage(docId, imageUrl, { width, height, caption });
          return { content: `图片已添加到文档` };
        } catch (err: any) {
          return { content: `添加失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_doc_merge",
      description: `合并多个 Word 文档到目标文档。
将其他文档的内容追加到目标文档末尾。`,
      inputSchema: {
        type: "object",
        properties: {
          targetDocId: { type: "string", description: "目标文档 ID（内容追加到此文档）" },
          sourceDocIds: {
            type: "array",
            description: "源文档 ID 列表",
            items: { type: "string" },
          },
        },
        required: ["targetDocId", "sourceDocIds"],
      },
      async execute(params) {
        const { targetDocId, sourceDocIds } = params as any;
        if (!targetDocId) return { content: "错误: 缺少 targetDocId", isError: true };
        if (!sourceDocIds?.length) return { content: "错误: 缺少源文档 ID 列表", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已合并 ${sourceDocIds.length} 个文档` };
        try {
          const { mergeDocuments } = await import("./office-engine.js");
          const count = await mergeDocuments(targetDocId, sourceDocIds);
          return { content: `已合并 ${count} 个文档到目标文档` };
        } catch (err: any) {
          return { content: `合并失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  高级 Excel 工具
    // ================================================================

    {
      name: "office_excel_open",
      description: `打开已有的 Excel 文件（.xlsx）。
读取后返回工作簿 ID，可用其他 Excel 工具操作。`,
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Excel 文件路径" },
        },
        required: ["filePath"],
      },
      async execute(params) {
        const { filePath } = params as any;
        if (!filePath) return { content: "错误: 缺少 filePath", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已打开 ${filePath}` };
        try {
          const { openExcelFile } = await import("./office-engine.js");
          const result = await openExcelFile(filePath);
          return { content: `已打开 Excel 文件: ${result.sheetCount} 个工作表\n工作表: ${result.sheetNames.join(", ")}\n工作簿 ID: ${result.id}` };
        } catch (err: any) {
          return { content: `打开失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_excel_add_formula",
      description: `在 Excel 单元格中插入公式。
公式使用 Excel 语法，如 "SUM(A1:A10)"、"AVERAGE(B1:B5)"。`,
      inputSchema: {
        type: "object",
        properties: {
          excelId: { type: "string", description: "Excel 工作簿 ID" },
          cellRef: { type: "string", description: "单元格引用，如 'C1'" },
          formula: { type: "string", description: "Excel 公式（不含 = 号），如 SUM(A1:A10)" },
          sheetName: { type: "string", description: "工作表名称（可选）" },
        },
        required: ["excelId", "cellRef", "formula"],
      },
      async execute(params) {
        const { excelId, cellRef, formula, sheetName } = params as any;
        if (!excelId) return { content: "错误: 缺少 excelId", isError: true };
        if (!formula) return { content: "错误: 缺少公式", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已插入公式 ${formula} 到 ${cellRef}` };
        try {
          const { addExcelFormula } = await import("./office-engine.js");
          await addExcelFormula(excelId, cellRef, formula, sheetName);
          return { content: `已插入公式 ${formula} 到 ${cellRef}` };
        } catch (err: any) {
          return { content: `插入失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_excel_sort",
      description: `对 Excel 工作表按指定列排序。
支持升序和降序，可选择是否有表头行。`,
      inputSchema: {
        type: "object",
        properties: {
          excelId: { type: "string", description: "Excel 工作簿 ID" },
          sheetName: { type: "string", description: "工作表名称" },
          column: { type: "string", description: "排序列字母，如 'A'、'B'" },
          order: { type: "string", description: "asc 升序 / desc 降序" },
          hasHeader: { type: "boolean", description: "第一行是否表头（默认 true）" },
        },
        required: ["excelId", "column", "order"],
      },
      async execute(params) {
        const { excelId, sheetName, column, order, hasHeader } = params as any;
        if (!excelId) return { content: "错误: 缺少 excelId", isError: true };
        if (!column) return { content: "错误: 缺少排序列", isError: true };
        if (!["asc", "desc"].includes(order)) return { content: "错误: order 需为 asc 或 desc", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已按 ${column} 列${order === "asc" ? "升" : "降"}序排序` };
        try {
          const { excelSortRange } = await import("./office-engine.js");
          await excelSortRange(excelId, sheetName || "", column, order, hasHeader !== false);
          return { content: `已按 ${column} 列${order === "asc" ? "升" : "降"}序排序` };
        } catch (err: any) {
          return { content: `排序失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_excel_merge_cells",
      description: `合并或取消合并 Excel 单元格。
range 格式如 "A1:C3"。merge=true 合并，false 取消合并。`,
      inputSchema: {
        type: "object",
        properties: {
          excelId: { type: "string", description: "Excel 工作簿 ID" },
          sheetName: { type: "string", description: "工作表名称" },
          range: { type: "string", description: "单元格范围，如 'A1:C3'" },
          merge: { type: "boolean", description: "true=合并, false=取消合并" },
        },
        required: ["excelId", "range", "merge"],
      },
      async execute(params) {
        const { excelId, sheetName, range, merge } = params as any;
        if (!excelId) return { content: "错误: 缺少 excelId", isError: true };
        if (!range) return { content: "错误: 缺少 range", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已${merge ? "合并" : "取消合并"} ${range}` };
        try {
          const { excelMergeCells } = await import("./office-engine.js");
          await excelMergeCells(excelId, sheetName || "", range, merge);
          return { content: `已${merge ? "合并" : "取消合并"} ${range}` };
        } catch (err: any) {
          return { content: `操作失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_excel_freeze_panes",
      description: `冻结 Excel 工作表的窗格。
冻结行和列上方的区域在滚动时保持可见。常用于冻结表头。`,
      inputSchema: {
        type: "object",
        properties: {
          excelId: { type: "string", description: "Excel 工作簿 ID" },
          sheetName: { type: "string", description: "工作表名称" },
          row: { type: "number", description: "冻结行数（从顶部开始），如 1 冻结第一行" },
          col: { type: "number", description: "冻结列数（从左侧开始），如 1 冻结第一列" },
        },
        required: ["excelId", "row", "col"],
      },
      async execute(params) {
        const { excelId, sheetName, row, col } = params as any;
        if (!excelId) return { content: "错误: 缺少 excelId", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已冻结 ${row || 0} 行 ${col || 0} 列` };
        try {
          const { excelFreezePanes } = await import("./office-engine.js");
          await excelFreezePanes(excelId, sheetName || "", row || 0, col || 0);
          return { content: `已冻结 ${row || 0} 行 ${col || 0} 列` };
        } catch (err: any) {
          return { content: `冻结失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_excel_format_range",
      description: `格式化 Excel 单元格区域。
支持字体、颜色、填充色、边框、对齐和数字格式。`,
      inputSchema: {
        type: "object",
        properties: {
          excelId: { type: "string", description: "Excel 工作簿 ID" },
          sheetName: { type: "string", description: "工作表名称" },
          range: { type: "string", description: "范围如 'A1:C10'" },
          bold: { type: "boolean", description: "加粗" },
          italic: { type: "boolean", description: "斜体" },
          fontSize: { type: "number", description: "字号" },
          fontColor: { type: "string", description: "字体颜色 HEX，如 #FF0000" },
          fillColor: { type: "string", description: "填充颜色 HEX，如 #FFFF00" },
          border: { type: "boolean", description: "添加边框" },
          horizontalAlignment: { type: "string", description: "水平对齐: left/center/right" },
          numberFormat: { type: "string", description: "数字格式，如 #,##0.00、0%" },
        },
        required: ["excelId", "range"],
      },
      async execute(params) {
        const { excelId, sheetName, range, ...format } = params as any;
        if (!excelId) return { content: "错误: 缺少 excelId", isError: true };
        if (!range) return { content: "错误: 缺少 range", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已格式化 ${range}` };
        try {
          const { excelFormatRange } = await import("./office-engine.js");
          await excelFormatRange(excelId, sheetName || "", range, format);
          return { content: `已格式化 ${range}` };
        } catch (err: any) {
          return { content: `格式化失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  高级 PowerPoint 工具
    // ================================================================

    {
      name: "office_ppt_add_table",
      description: `在 PowerPoint 幻灯片中添加表格。
数据显示为二维数组，第一行自动加粗为表头。`,
      inputSchema: {
        type: "object",
        properties: {
          pptId: { type: "string", description: "演示文稿 ID" },
          slideIndex: { type: "number", description: "幻灯片序号（从 0 开始）" },
          data: {
            type: "array",
            description: "表格数据: 二维字符串数组",
            items: { type: "array", items: { type: "string" } },
          },
          title: { type: "string", description: "幻灯片标题（可选）" },
        },
        required: ["pptId", "slideIndex", "data"],
      },
      async execute(params) {
        const { pptId, slideIndex, data, title } = params as any;
        if (!pptId) return { content: "错误: 缺少 pptId", isError: true };
        if (slideIndex === undefined) return { content: "错误: 缺少 slideIndex", isError: true };
        if (!data?.length) return { content: "错误: 缺少数据", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已添加 ${data.length} 行表格到幻灯片 ${slideIndex}` };
        try {
          const { addPptTable } = await import("./office-engine.js");
          await addPptTable(pptId, slideIndex, data, { title });
          return { content: `已添加 ${data.length} 行表格到幻灯片 ${slideIndex}` };
        } catch (err: any) {
          return { content: `添加失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_ppt_add_chart",
      description: `在 PowerPoint 幻灯片中添加图表。
支持柱状图、折线图、饼图。需提供分类标签和系列数据。`,
      inputSchema: {
        type: "object",
        properties: {
          pptId: { type: "string", description: "演示文稿 ID" },
          slideIndex: { type: "number", description: "幻灯片序号（从 0 开始）" },
          type: { type: "string", description: "图表类型: bar/line/pie/column" },
          title: { type: "string", description: "图表标题" },
          categories: {
            type: "array", description: "分类标签",
            items: { type: "string" },
          },
          series: {
            type: "array",
            description: "数据系列",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                data: { type: "array", items: { type: "number" } },
              },
            },
          },
        },
        required: ["pptId", "slideIndex", "type", "categories", "series"],
      },
      async execute(params) {
        const { pptId, slideIndex, type, title, categories, series } = params as any;
        if (!pptId) return { content: "错误: 缺少 pptId", isError: true };
        if (!["bar", "line", "pie", "column"].includes(type)) return { content: "错误: type 需为 bar/line/pie/column", isError: true };
        if (!series?.length) return { content: "错误: 缺少数据系列", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已添加 ${type} 图表到幻灯片 ${slideIndex}` };
        try {
          const { addPptChart } = await import("./office-engine.js");
          await addPptChart(pptId, slideIndex, { type, title, categories, series });
          return { content: `已添加 ${type} 图表到幻灯片 ${slideIndex}` };
        } catch (err: any) {
          return { content: `添加失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_ppt_add_notes",
      description: `在 PowerPoint 幻灯片中添加演讲者备注。
备注内容在演示时演讲者可见，观众不可见。`,
      inputSchema: {
        type: "object",
        properties: {
          pptId: { type: "string", description: "演示文稿 ID" },
          slideIndex: { type: "number", description: "幻灯片序号（从 0 开始）" },
          notes: { type: "string", description: "演讲者备注内容" },
        },
        required: ["pptId", "slideIndex", "notes"],
      },
      async execute(params) {
        const { pptId, slideIndex, notes } = params as any;
        if (!pptId) return { content: "错误: 缺少 pptId", isError: true };
        if (slideIndex === undefined) return { content: "错误: 缺少 slideIndex", isError: true };
        if (!notes) return { content: "错误: 缺少备注内容", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已添加演讲者备注到幻灯片 ${slideIndex}` };
        try {
          const { setPptSpeakerNotes } = await import("./office-engine.js");
          await setPptSpeakerNotes(pptId, slideIndex, notes);
          return { content: `已添加演讲者备注到幻灯片 ${slideIndex}` };
        } catch (err: any) {
          return { content: `添加失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  高级格式 & 公文式工具
    // ================================================================

    {
      name: "office_doc_set_margins",
      description: `设置 Word 文档的页面边距（单位: 厘米）。
公文标准: 上 3.7cm, 下 3.5cm, 左 2.8cm, 右 2.6cm`,
      inputSchema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "文档 ID" },
          top: { type: "number", description: "上边距 cm（公文标准 3.7）" },
          bottom: { type: "number", description: "下边距 cm（公文标准 3.5）" },
          left: { type: "number", description: "左边距 cm（公文标准 2.8）" },
          right: { type: "number", description: "右边距 cm（公文标准 2.6）" },
        },
        required: ["docId"],
      },
      async execute(params) {
        const { docId, top, bottom, left, right } = params as any;
        if (!docId) return { content: "错误: 缺少 docId", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已设置页边距 T:${top} B:${bottom} L:${left} R:${right}cm` };
        try {
          const { setDocMargins } = await import("./office-engine.js");
          await setDocMargins(docId, top, bottom, left, right);
          return { content: `已设置页边距 (上:${top || "-"} 下:${bottom || "-"} 左:${left || "-"} 右:${right || "-"} cm)` };
        } catch (err: any) {
          return { content: `设置失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_doc_set_line_spacing",
      description: `设置 Word 文档的行距和段落间距。
行距单位: 1.0/1.5/2.0 等倍数，或直接传入磅值（公文正文标准: 28 磅）。
段前/段后距单位: 磅。`,
      inputSchema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "文档 ID" },
          lineSpacing: { type: "number", description: "行距（磅），公文标准 28 磅" },
          paragraphBefore: { type: "number", description: "段前距（磅）" },
          paragraphAfter: { type: "number", description: "段后距（磅）" },
        },
        required: ["docId"],
      },
      async execute(params) {
        const { docId, lineSpacing, paragraphBefore, paragraphAfter } = params as any;
        if (!docId) return { content: "错误: 缺少 docId", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已设置行距` };
        try {
          const { setDocLineSpacing } = await import("./office-engine.js");
          await setDocLineSpacing(docId, { lineSpacing, paragraphBefore, paragraphAfter });
          return { content: `已设置行距${lineSpacing ? ` ${lineSpacing} 磅` : ""}${paragraphBefore ? ` 段前 ${paragraphBefore} 磅` : ""}${paragraphAfter ? ` 段后 ${paragraphAfter} 磅` : ""}` };
        } catch (err: any) {
          return { content: `设置失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_doc_add_page_number",
      description: `为 Word 文档添加页码。
支持居中/左/右对齐，可指定起始数字。`,
      inputSchema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "文档 ID" },
          align: { type: "string", description: "对齐: center/left/right（默认 center）" },
          startAt: { type: "number", description: "起始页码（默认 1）" },
        },
        required: ["docId"],
      },
      async execute(params) {
        const { docId, align, startAt } = params as any;
        if (!docId) return { content: "错误: 缺少 docId", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已添加页码` };
        try {
          const { setDocPageNumber } = await import("./office-engine.js");
          await setDocPageNumber(docId, align || "center", startAt || 1);
          return { content: `已${startAt ? `从 ${startAt} 开始` : ""}添加页码（${align || "居中"}）` };
        } catch (err: any) {
          return { content: `添加失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_doc_create_official",
      description: `一键创建符合中国公文国标（GB/T 9704-2012）的正式公文。

自动设置以下格式:
- 页边距: 上3.7cm 下3.5cm 左2.8cm 右2.6cm
- 标题: 二号宋体加粗居中
- 正文: 三号仿宋, 28磅行距, 首行缩进2字符
- 一级标题: 黑体
- 二级标题: 楷体
- 文号/签发人区域自动排版
- 页码居中`,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "公文标题" },
          docNumber: { type: "string", description: "文号，如 'XX发〔2026〕15号'" },
          issuer: { type: "string", description: "签发人（可选）" },
          bodySections: {
            type: "array",
            description: "正文内容数组",
            items: {
              type: "object",
              properties: {
                type: { type: "string", description: "段落类型: p(正文) / h1(一级标题) / h2(二级标题) / table(表格)" },
                text: { type: "string", description: "文本内容（type=p/h1/h2 时必填）" },
                data: { type: "array", description: "表格数据二维数组（type=table 时必填）" },
              },
            },
          },
          attachments: { type: "string", description: "附件说明（可选）" },
          date: { type: "string", description: "成文日期（如 2026年5月7日）" },
          sealUnit: { type: "string", description: "发文机关（可选，用于落款）" },
        },
        required: ["title", "bodySections"],
      },
      async execute(params) {
        if (isSandbox()) {
          return { content: `[沙箱] 公文已创建: ${(params as any).title}` };
        }
        try {
          const { createOfficialDoc, saveDocx } = await import("./office-engine.js");
          const docRef = await createOfficialDoc(params as any);
          return { content: `公文已创建（ID: ${docRef.id}，${docRef.paragraphCount} 个段落），调用 office_doc_save 保存到文件` };
        } catch (err: any) {
          return { content: `创建失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_doc_format_paragraph",
      description: `格式化文档中指定段落。
支持缩进、对齐、边框、底纹等高级格式选项。`,
      inputSchema: {
        type: "object",
        properties: {
          docId: { type: "string", description: "文档 ID" },
          paragraphIndex: { type: "number", description: "段落序号（从 0 开始）" },
          indentFirstLine: { type: "number", description: "首行缩进（字符数），公文标准 2" },
          alignment: { type: "string", description: "对齐: left/center/right/both" },
          borderTop: { type: "boolean", description: "上边框" },
          borderBottom: { type: "boolean", description: "下边框" },
          shading: { type: "string", description: "底纹颜色 HEX，如 #F2F2F2" },
        },
        required: ["docId"],
      },
      async execute(params) {
        const { docId, paragraphIndex, ...opts } = params as any;
        if (!docId) return { content: "错误: 缺少 docId", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已格式化段落 ${paragraphIndex}` };
        try {
          const { formatDocParagraph } = await import("./office-engine.js");
          await formatDocParagraph(docId, paragraphIndex, opts);
          return { content: `已格式化段落 ${paragraphIndex}` };
        } catch (err: any) {
          return { content: `格式化失败: ${err.message}`, isError: true };
        }
      },
    },

    // ================================================================
    //  PPT 视觉设计工具
    // ================================================================

    {
      name: "office_ppt_set_theme",
      description: `设置演示文稿的主题配色方案。
通过主色、辅色、背景色等定义整体视觉风格。`,
      inputSchema: {
        type: "object",
        properties: {
          pptId: { type: "string", description: "演示文稿 ID" },
          primaryColor: { type: "string", description: "主色 HEX，如 #4472C4（蓝色系）" },
          secondaryColor: { type: "string", description: "辅色 HEX，如 #ED7D31" },
          backgroundColor: { type: "string", description: "背景色 HEX，如 #FFFFFF" },
          fontColor: { type: "string", description: "字体颜色 HEX，如 #333333" },
          accentColor: { type: "string", description: "强调色 HEX，如 #70AD47" },
        },
        required: ["pptId"],
      },
      async execute(params) {
        const { pptId, ...colors } = params as any;
        if (!pptId) return { content: "错误: 缺少 pptId", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已设置主题配色` };
        try {
          const { setPptTheme } = await import("./office-engine.js");
          await setPptTheme(pptId, colors);
          return { content: `已设置主题配色` };
        } catch (err: any) {
          return { content: `设置失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_ppt_style_slide",
      description: `设置单张幻灯片的视觉样式。
支持背景色/渐变、配色方案覆盖。`,
      inputSchema: {
        type: "object",
        properties: {
          pptId: { type: "string", description: "演示文稿 ID" },
          slideIndex: { type: "number", description: "幻灯片序号（从 0 开始）" },
          background: { type: "string", description: "背景颜色 HEX" },
          gradient: { type: "boolean", description: "是否使用渐变背景" },
          gradientColor1: { type: "string", description: "渐变色1" },
          gradientColor2: { type: "string", description: "渐变色2" },
        },
        required: ["pptId", "slideIndex"],
      },
      async execute(params) {
        const { pptId, slideIndex, ...opts } = params as any;
        if (!pptId) return { content: "错误: 缺少 pptId", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已设置幻灯片 ${slideIndex} 样式` };
        try {
          const { setPptSlideStyle } = await import("./office-engine.js");
          await setPptSlideStyle(pptId, slideIndex, opts);
          return { content: `已设置幻灯片 ${slideIndex} 样式` };
        } catch (err: any) {
          return { content: `设置失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_ppt_add_transition",
      description: `为幻灯片设置切换效果。
支持: fade(淡入) / push(推入) / wipe(擦除) / split(拆分) / reveal(揭示) / random(随机)。`,
      inputSchema: {
        type: "object",
        properties: {
          pptId: { type: "string", description: "演示文稿 ID" },
          slideIndex: { type: "number", description: "幻灯片序号（从 0 开始，-1 为全部）" },
          effect: { type: "string", description: "切换效果: fade/push/wipe/split/reveal/random" },
          duration: { type: "number", description: "持续时间（秒，默认 0.5）" },
        },
        required: ["pptId", "effect"],
      },
      async execute(params) {
        const { pptId, slideIndex = -1, effect, duration } = params as any;
        if (!pptId) return { content: "错误: 缺少 pptId", isError: true };
        const validEffects = ["fade", "push", "wipe", "split", "reveal", "random"];
        if (!validEffects.includes(effect)) return { content: `错误: effect 需为 ${validEffects.join("/")}`, isError: true };
        if (isSandbox()) return { content: `[沙箱] 已设置切换效果: ${effect}` };
        try {
          const { setPptTransition } = await import("./office-engine.js");
          await setPptTransition(pptId, slideIndex, effect, duration || 0.5);
          return { content: `已设置切换效果: ${effect}${slideIndex >= 0 ? ` (幻灯片 ${slideIndex})` : "（全部）"}` };
        } catch (err: any) {
          return { content: `设置失败: ${err.message}`, isError: true };
        }
      },
    },

    {
      name: "office_ppt_format_text",
      description: `格式化幻灯片中的文本。
支持阴影、发光、字间距、行距等高级文本效果。`,
      inputSchema: {
        type: "object",
        properties: {
          pptId: { type: "string", description: "演示文稿 ID" },
          slideIndex: { type: "number", description: "幻灯片序号（从 0 开始）" },
          elementIndex: { type: "number", description: "文本元素序号（从 0 开始）" },
          fontSize: { type: "number", description: "字号（磅）" },
          fontColor: { type: "string", description: "字体颜色 HEX" },
          bold: { type: "boolean" },
          italic: { type: "boolean" },
          shadow: { type: "boolean", description: "文字阴影" },
          fontFace: { type: "string", description: "字体，如 微软雅黑 / Arial" },
        },
        required: ["pptId", "slideIndex", "elementIndex"],
      },
      async execute(params) {
        const { pptId, slideIndex, elementIndex, ...opts } = params as any;
        if (!pptId) return { content: "错误: 缺少 pptId", isError: true };
        if (isSandbox()) return { content: `[沙箱] 已格式化文本` };
        try {
          const { formatPptText } = await import("./office-engine.js");
          await formatPptText(pptId, slideIndex, elementIndex, opts);
          return { content: `已格式化文本` };
        } catch (err: any) {
          return { content: `格式化失败: ${err.message}`, isError: true };
        }
      },
    },
  ];
}
