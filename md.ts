import { App, TFile, TFolder } from "obsidian";

import {
    ensureFolderExists,
    readTopLevelMetadata,
    sanitizeFileName,
} from "./utils";


export async function saveBookMetadata(folderPath: string, bookId: number, bookTitle: string) {
    const metadataPath = `${folderPath}/metadata.md`;
    const metadataContent = `---\n` +
        `id: ${bookId}\n` +
        `title: ${bookTitle}\n` +
        `---\n`;

    const existingFile = this.app.vault.getAbstractFileByPath(metadataPath);
    if (existingFile) {
        // 기존 파일 업데이트
        await this.app.vault.modify(existingFile as TFile, metadataContent);
    } else {
        // 새 파일 생성
        await this.app.vault.create(metadataPath, metadataContent);
    }
}

async function getParentId(file: TFile) {
    // 1. 부모 폴더 가져오기
    const parentFolder = file.parent;
    if (!(parentFolder instanceof TFolder)) {
        // console.warn(`The file "${file.path}" does not have a parent folder.`);
        return -1;
    }

    const grandParentFolder = parentFolder.parent;
    if (!(grandParentFolder instanceof TFolder)) {
        // console.warn(`The parent folder "${parentFolder.path}" does not have a parent folder.`);
        return -1;
    }

    // 2. 부모 폴더와 동일한 이름의 .md 파일 경로 찾기
    const parentFolderName = parentFolder.name;
    const potentialFilePath = `${grandParentFolder.path}/${parentFolderName}.md`;
    const abstractFile = file.vault.getAbstractFileByPath(potentialFilePath);

    if (!(abstractFile instanceof TFile) || abstractFile.extension !== "md") {
        // console.warn(`No matching .md file found for parent folder "${parentFolderName}".`);
        return -1;
    }

    const content = await file.vault.read(abstractFile);
    const frontMatterMatch = content.match(/---[\s\S]*?---/);
    if (!frontMatterMatch) {
        // console.warn(`No FrontMatter found in the file: ${potentialFilePath}`);
        return -1;
    }

    const frontMatterContent = frontMatterMatch[0];
    const idMatch = frontMatterContent.match(/id:\s*(\d+)/);
    if (!idMatch) {
        // console.warn(`No 'id' field found in FrontMatter of the file: ${potentialFilePath}`);
        return -1;
    }

    const parentFileId = parseInt(idMatch[1], 10);
    return parentFileId;
}

function getPureContent(content: string): string {
    // Front Matter 감지 (---로 시작하고 끝나는 블록)
    const frontMatterMatch = content.match(/^---[\s\S]*?---\n/);

    if (frontMatterMatch) {
        // Front Matter 제외하고 순수 콘텐츠 반환
        return content.slice(frontMatterMatch[0].length).trim();
    }

    // Front Matter가 없으면 원본 콘텐츠 반환
    return content.trim();
}

export async function addFrontMatterToFile(file: TFile) {
    const now = new Date().toISOString();
    // const parentFolderPath = readTopLevelMetadata(file);

    let bookId = -1; // 기본값
    const metadata = await readTopLevelMetadata(file);
    if (metadata && metadata.id) {
        bookId = typeof metadata.id === "string" ? parseInt(metadata.id, 10) : metadata.id as number;
    } else {
        console.warn("No ID found in metadata.md.");
    }

    const parentId = await getParentId(file);

    const content = await this.app.vault.read(file);
    const frontMatterMatch = content.match(/^---[\s\S]*?---\n/);

    let updatedContent;
    if (frontMatterMatch) { // 기존에 있는 파일
        const metadata = await extractMetadataFromFrontMatter(file);
        const frontMatter = `---\n` +
        `id: ${metadata.id}\n` + // 고유 ID 생성
        `book_id: ${bookId}\n` + // metadata.md에서 읽은 book_id 추가
        `parent_id: ${parentId}\n` + // parentId
        `subject: ${metadata.subject}\n` + // 파일 이름을 제목으로 사용
        `last_synced:\n` +
        `---\n`;

        updatedContent = frontMatter + getPureContent(content);
    }else { // 신규 생성
        const frontMatter = `---\n` +
        `id: -1\n` + // 고유 ID 생성
        `book_id: ${bookId}\n` + // metadata.md에서 읽은 book_id 추가
        `parent_id: ${parentId}\n` + // parentId
        `subject: ${sanitizeFileName(file.basename)}\n` + // 파일 이름을 제목으로 사용
        `last_synced: ${now}\n` +
        `---\n`;
        updatedContent = frontMatter + content;
    }

    await this.app.vault.modify(file, updatedContent);
}

export async function getBookIdFromMetadata(folderPath: string): Promise<number | null> {
    const metadataPath = `${folderPath}/metadata.md`;
    const file = this.app.vault.getAbstractFileByPath(metadataPath);

    if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        const match = content.match(/id:\s*(\d+)/);
        if (match) {
            return parseInt(match[1], 10);
        }
    }

    return null;
}

export async function updatePagesInFolder(pages: any[], folderPath: string) {
    for (const page of pages) {
        const sanitizedFileName = sanitizeFileName(page.subject);
        const filePath = `${folderPath}/${sanitizedFileName}.md`;

        try {
            const existingFile = this.app.vault.getAbstractFileByPath(filePath);

            const frontMatter = `---\n` +
                `id: ${page.id}\n` +
                `subject: ${page.subject}\n` +
                `parent_id: ${page.parent_id ?? "null"}\n` +
                // `depth: ${page.depth ?? 0}\n` +
                // `seq: ${page.seq ?? 0}\n` +
                `---\n\n`;

            const content = frontMatter + (page.content ?? "No content available.");

            if (existingFile instanceof TFile) {
                // 기존 파일이 있으면 업데이트
                await this.app.vault.modify(existingFile, content);
            } else {
                // 파일이 없으면 새로 생성
                await this.app.vault.create(filePath, content);
            }

            // 하위 페이지 처리
            if (page.children && page.children.length > 0) {
                const childFolderPath = `${folderPath}/${sanitizedFileName}`;
                await this.ensureFolderExists(childFolderPath);
                await this.updatePagesInFolder(page.children, childFolderPath);
            }
        } catch (error) {
            console.error(`Failed to update page: ${page.subject}`, error);
        }
    }
}

export async function extractMetadataFromFrontMatter(file: TFile): 
        Promise<{ id: number; subject: string; last_synced?: string; book_id?: number; parent_id?: number; open_yn?: string;}> {
    const content = await this.app.vault.read(file);
    const frontMatterMatch = content.match(/---([\s\S]*?)---/);

    if (frontMatterMatch) {
        const frontMatterContent = frontMatterMatch[1];
        const metadata: { [key: string]: string | number } = {};

        frontMatterContent.split("\n").forEach((line: string) => {
            const colonIndex = line.indexOf(":");
            if (colonIndex !== -1) {
                const key = line.slice(0, colonIndex).trim();
                const value = line.slice(colonIndex + 1).trim();
                if (key && value) {
                    metadata[key] = isNaN(Number(value)) ? value : Number(value);
                }
            }
        });

        if (metadata.parent_id && typeof metadata.parent_id === "string") {
            metadata.parent_id = metadata.parent_id.replace(/^"|"$/g, "");
            metadata.parent_id = parseInt(metadata.parent_id);
        }

        if (metadata.id && metadata.subject) {
            return {
                id: metadata.id as number,
                subject: metadata.subject as string,
                last_synced: metadata.last_synced as string,
                book_id: metadata.book_id as number,
                parent_id: metadata.parent_id as number,
                open_yn: metadata.open_yn as string,
            };
        } else {
            throw new Error("Front Matter must contain 'id' and 'subject'.");
        }
    } else {
        throw new Error(`No Front Matter found in file: ${file.path}`);
    }
}

export async function savePagesToMarkdown(app:App, pages: any[], folderPath: string) {
    for (const page of pages) {
        const sanitizedFileName = sanitizeFileName(page.subject);
        const filePath = `${folderPath}/${sanitizedFileName}.md`;

        try {
            const now = new Date().toISOString();
            // Front Matter 생성
            const frontMatter = `---\n` +
                `id: ${page.id}\n` +
                `subject: ${page.subject}\n` +
                `parent_id: ${page.parent_id ?? -1}\n` +
                `open_yn: ${page.open_yn}\n` +
                // `depth: ${page.depth ?? 0}\n` +
                // `seq: ${page.seq ?? 0}\n` +
                `last_synced: ${now}\n` +
                // `icon: "${page.open_yn === "N" ? "IbLocked" : ""}"\n` +  // 자물쇠 아이콘 추가
                `---\n`;

            // 페이지 내용 추가
            const content = frontMatter + (page.content ?? "No content available.");

            // 파일 생성
            await this.app.vault.create(filePath, content);

            if (page.open_yn === "N") {
                // addLockIcon(filePath);
                // await addLockIcon(app, filePath);
            }

            // 하위 페이지 처리
            if (page.children && page.children.length > 0) {
                const childFolderPath = `${folderPath}/${sanitizedFileName}`;
                await ensureFolderExists(childFolderPath);
                await savePagesToMarkdown(app, page.children, childFolderPath);
            }
        } catch (error) {
            console.error(`Failed to save page: ${page.subject}`, error);
        }
    }
}
