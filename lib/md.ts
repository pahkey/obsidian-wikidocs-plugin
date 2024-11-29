import { App, TFile, TFolder } from "obsidian";

import {
    ensureFolderExists,
    readTopLevelMetadata,
    sanitizeFileName,
} from "./utils";


export class PageMetadata {
    id: number;
    subject: string;
    book_id?: number;
    parent_id?: number;
    open_yn?: string;
    last_synced?: string;

    constructor(data: {
        id: number;
        subject: string;
        last_synced?: string;
        book_id?: number;
        parent_id?: number;
        open_yn?: string;
    }) {
        this.id = data.id;
        this.subject = data.subject;
        this.last_synced = data.last_synced;
        this.book_id = data.book_id;
        this.parent_id = data.parent_id;
        this.open_yn = data.open_yn;
    }

    // Front Matter를 파싱하여 객체 생성
    static fromFrontMatter(frontMatter: string): PageMetadata {
        const metadata: { [key: string]: string | number | undefined } = {};

        const lines = frontMatter.split("\n");
        for (const line of lines) {
            const colonIndex = line.indexOf(":");
            if (colonIndex !== -1) {
                const key = line.slice(0, colonIndex).trim();
                const value = line.slice(colonIndex + 1).trim();
                metadata[key] = isNaN(Number(value)) ? value : Number(value);
            }
        }

        if (!metadata.id || !metadata.subject) {
            throw new Error("Front Matter must contain 'id' and 'subject'.");
        }

        if (metadata.parent_id && typeof metadata.parent_id === "string") {
            metadata.parent_id = metadata.parent_id.replace(/^"|"$/g, "");
            metadata.parent_id = parseInt(metadata.parent_id);
        }

        return new PageMetadata({
            id: metadata.id as number,
            subject: metadata.subject as string,
            last_synced: metadata.last_synced as string,
            book_id: metadata.book_id as number,
            parent_id: metadata.parent_id as number,
            open_yn: metadata.open_yn as string,
        });
    }

    // 필요한 추가 메서드
    isLocked(): boolean {
        return this.open_yn === "N";
    }

    updateLastSynced(): void {
        this.last_synced = new Date().toISOString();
    }

    getFrontMatter(): string {
        const frontMatter = `---\n` +
            `id: ${this.id}\n` +
            `subject: ${this.subject}\n` +
            `book_id: ${this.book_id ?? -1}\n` +
            `parent_id: ${this.parent_id ?? -1}\n` +
            `open_yn: ${this.open_yn}\n` +
            `last_synced: ${this.last_synced}\n` +
            `---\n`;
        return frontMatter;
    }
}


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
        metadata.parent_id = parentId;
        metadata.last_synced = ''; // 동기화를 위해 비워둔다.
        const frontMatter = metadata.getFrontMatter();
        updatedContent = frontMatter + getPureContent(content);
    }else { // 신규 생성
        const metadata = new PageMetadata({
            id: -1,
            subject: sanitizeFileName(file.basename),
            last_synced: now,
            book_id: bookId,
            parent_id: parentId,
        });
        const frontMatter = metadata.getFrontMatter();
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

export async function extractMetadataFromFrontMatter(file: TFile): 
        Promise<PageMetadata> {
    const content = await this.app.vault.read(file);
    const frontMatterMatch = content.match(/---([\s\S]*?)---/);
    if (frontMatterMatch) {
        return PageMetadata.fromFrontMatter(frontMatterMatch[1]);
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
            const metadata = new PageMetadata(page);
            metadata.last_synced = now;
            const frontMatter = metadata.getFrontMatter();

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
