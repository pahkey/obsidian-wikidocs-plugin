import { App, TFile } from "obsidian";

import {
    sanitizeFileName
} from "./utils";


export class BlogMetadata {
    id: number;
    blog_profile_id: number;
    last_synced?: string;
    is_public:boolean;

    constructor(data: {
        id: number;
        blog_profile_id: number;
        last_synced?: string;
        is_public:boolean;
    }) {
        this.id = data.id;
        this.blog_profile_id = data.blog_profile_id;
        this.last_synced = data.last_synced;
        this.is_public = data.is_public;
    }

    // Front Matter를 파싱하여 객체 생성
    static fromFrontMatter(frontMatter: string): BlogMetadata {
        const metadata: { [key: string]: string | number | boolean | undefined } = {};

        const lines = frontMatter.split("\n");
        for (const line of lines) {
            const colonIndex = line.indexOf(":");
            if (colonIndex !== -1) {
                const key = line.slice(0, colonIndex).trim();
                const value = line.slice(colonIndex + 1).trim();
                metadata[key] = isNaN(Number(value)) ? value : Number(value);
            }
        }

        if (!metadata.id || !metadata.blog_profile_id) {
            throw new Error("Front Matter must contain 'id' and 'blog_profile_id'.");
        }

        return new BlogMetadata({
            id: metadata.id as number,
            blog_profile_id: metadata.blog_profile_id as number,
            last_synced: metadata.last_synced as string,
            is_public: metadata.is_public as boolean,
        });
    }

    updateLastSynced(): void {
        this.last_synced = new Date().toISOString();
    }

    getFrontMatter(): string {
        const frontMatter = `---\n` +
            `id: ${this.id}\n` +
            `blog_profile_id: ${this.blog_profile_id}\n` +
            `is_public: ${this.is_public}\n` +
            `last_synced: ${this.last_synced}\n` +
            `---\n`;
        return frontMatter;
    }
}

export async function saveBlogMetadata(folderPath: string, blogProfileId: number, url: string) {
    const metadataPath = `${folderPath}/blog-metadata.md`;
    const metadataContent = `---\n` +
        `id: ${blogProfileId}\n` +
        `url: ${url}\n` +
        `---\n`;

    const existingFile = this.app.vault.getAbstractFileByPath(metadataPath);

    if (existingFile instanceof TFile) {
        // 기존 파일 업데이트
        await this.app.vault.modify(existingFile, metadataContent);
    } else if (!existingFile) {
        // 새 파일 생성
        await this.app.vault.create(metadataPath, metadataContent);
    } else {
        // 예상치 못한 타입의 파일 처리
        console.error(`The path "${metadataPath}" exists but is not a valid file.`);
    }
}


export async function saveBlogToMarkdown(app:App, pages: any[], folderPath: string) {
    for (const page of pages) {
        const sanitizedFileName = sanitizeFileName(page.title);
        const filePath = `${folderPath}/${sanitizedFileName}.md`;

        try {
            const now = new Date().toISOString();
            
            // Front Matter 생성
            const metadata = new BlogMetadata(page);
            metadata.last_synced = now;
            const frontMatter = metadata.getFrontMatter();
            const hashTags = convertToHashtags(page.tags);

            // 페이지 내용 추가
            let content = frontMatter;
            if (hashTags.trim()) {
                content += hashTags + "\n\n";
            }
            content += page.content ?? "No content available.";

            // 파일 생성
            await this.app.vault.create(filePath, content);
            
        } catch (error) {
            console.error(`Failed to save page: ${page.title}`, error);
        }
    }
}

function convertToHashtags(input: string): string {
    // 입력값이 빈 문자열이면 빈 문자열을 반환
    if (input.trim() === "") {
        return "";
    }

    return input
        .split(",") // 문자열을 콤마로 분리
        .map((word: string) => `#${word.trim()}`) // 각 단어 앞에 "#"을 붙이고, 앞뒤 공백을 제거
        .join(" "); // 결과를 공백으로 연결
}