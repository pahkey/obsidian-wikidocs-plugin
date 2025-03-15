import { App, TFile, TFolder } from "obsidian";

import {
    ensureFolderExists,
    extractTitleFromFilePath,
    getFileModifiedTime,
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

        if (this.subject.includes("#")) {
            this.subject = `"${this.subject}"`; // 따옴표로 감싸기
        }
    }

    // MetadataCache에서 제공된 frontmatter 객체를 처리
    static fromFrontMatter(frontMatter: Record<string, any>): PageMetadata {
        if (!frontMatter.id || !frontMatter.subject) {
            throw new Error("Front Matter must contain 'id' and 'subject'.");
        }
        
        return new PageMetadata({
            id: frontMatter.id,
            subject: frontMatter.subject,
            last_synced: frontMatter.last_synced,
            book_id: frontMatter.book_id,
            parent_id: frontMatter.parent_id,
            open_yn: frontMatter.open_yn,
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

    // 3. MetadataCache를 사용하여 FrontMatter에서 id 가져오기
    const fileCache = this.app.metadataCache.getFileCache(abstractFile);
    if (!fileCache || !fileCache.frontmatter) {
        // console.warn(`No FrontMatter found in the file: ${potentialFilePath}`);
        return -1;
    }

    const frontMatter = fileCache.frontmatter;
    if (!frontMatter.id || typeof frontMatter.id !== "number") {
        // console.warn(`No 'id' field found in FrontMatter of the file: ${potentialFilePath}`);
        return -1;
    }

    return frontMatter.id;
}


export function getPureContent(content: string): string {
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
        // console.warn("No ID found in metadata.md.");
    }

    const parentId = await getParentId(file);
    // processFrontMatter를 사용하여 파일의 Front Matter 수정 또는 추가
    await this.app.fileManager.processFrontMatter(file, (frontMatter: Record<string, unknown>) => {
        if (!frontMatter) {
            // Front Matter가 없는 경우 새로 추가
            frontMatter = {};
        }

        // 필요한 값 추가 또는 업데이트
        frontMatter["id"] = frontMatter["id"] || -1;
        frontMatter["subject"] = frontMatter["subject"] || sanitizeFileName(file.basename);
        frontMatter["last_synced"] = ''; // 동기화를 위해 비워둔다.
        frontMatter["book_id"] = bookId;
        frontMatter["parent_id"] = parentId;
    });
}


export async function getBookIdFromMetadata(folderPath: string): Promise<number | null> {
    const metadataPath = `${folderPath}/metadata.md`;
    const file = this.app.vault.getAbstractFileByPath(metadataPath);

    if (file instanceof TFile) {
        const fileCache = this.app.metadataCache.getFileCache(file);
        // Check if the file has frontmatter
        if (fileCache?.frontmatter && fileCache.frontmatter.id) {
            return parseInt(fileCache.frontmatter.id, 10);
        }
    }

    return null;
}


export async function extractMetadataFromFrontMatter(file: TFile): 
        Promise<PageMetadata> {
    // Access the metadata cache
    const fileCache = this.app.metadataCache.getFileCache(file);

    // Check if frontMatter exists in the cache
    if (fileCache?.frontmatter) {
        return PageMetadata.fromFrontMatter(fileCache.frontmatter);
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


export async function isNeedSync(app:App, folder:TFolder) {
    const files = this.app.vault.getFiles().filter((file: { path: string; }) => file.path.startsWith(folder.path));

    let changedCount = 0;
    for (const file of files) {
        if (file.name === "metadata.md") {
            continue;
        }

        const fileContent = await this.app.vault.read(file);
        const metadata = await extractMetadataFromFrontMatter(file);

        if (!metadata.id) {
            console.error(`No ID found in Front Matter for file: ${file.path}`);
            continue;
        }

        // 동기화 시점 확인
        const lastSynced = metadata.last_synced ? new Date(metadata.last_synced) : null;
        const fileModifiedAt = getFileModifiedTime(file);

        const needsSync =
            !lastSynced || 
            fileModifiedAt.getTime() - lastSynced.getTime() > 1000 || // 수정 시간 비교
            sanitizeFileName(metadata.subject) !== sanitizeFileName(extractTitleFromFilePath(file.path)); // 제목 변경 감지

        if (needsSync) {
            changedCount++;
        }
    }
    
    if(changedCount > 0) {
        return true;
    }else {
        return false;
    }
}


export async function addLockIconToFile(file: TFile) {
    // 메타데이터 읽기
    const metadata = this.app.metadataCache.getFileCache(file);
    if (metadata?.frontmatter?.open_yn === "N") {
        // 파일 탐색기에서 해당 파일에 자물쇠 아이콘 추가
        const explorerLeaf = document.querySelector(
            `.nav-file-title[data-path="${file.path}"]`
        );
        if (explorerLeaf) {
            // 이미 아이콘이 추가된 경우 중복 추가 방지
            const existingIcon = explorerLeaf.querySelector(".lock-icon");
            if (!existingIcon) {
                const lockIcon = document.createElement("span");
                lockIcon.className = "lock-icon";
                explorerLeaf.appendChild(lockIcon);
            }
        }
    } else {
        // open_yn이 "Y" 또는 없는 경우 아이콘 제거
        const explorerLeaf = document.querySelector(
            `.nav-file-title[data-path="${file.path}"]`
        );
        if (explorerLeaf) {
            const existingIcon = explorerLeaf.querySelector(".lock-icon");
            if (existingIcon) {
                existingIcon.remove();
            }
        }
    }
}


export async function addBlogIconToFolder(folderPath:any) {

    setTimeout(() => {
        const explorerLeaf = document.querySelector(
            `.nav-folder-title[data-path="${folderPath}"]`
        );
        
        if (explorerLeaf) {
            // 이미 아이콘이 추가된 경우 중복 추가 방지
            const existingIcon = explorerLeaf.querySelector(".blog-icon");
            if (!existingIcon) {
                const blogIcon = document.createElement("span");
                blogIcon.className = "blog-icon";
                blogIcon.textContent = "📝"; // 블로그 아이콘 (이모지 또는 아이콘 라이브러리 활용 가능)
                blogIcon.style.marginRight = "5px"; // 아이콘과 글씨 사이 여백 추가
                explorerLeaf.prepend(blogIcon); // 폴더명 앞에 아이콘 추가
            }
        }
    }, 500); // 500ms 딜레이 추가
}

export async function addBlogIconToFile(folderPath:any, blog:any) {

    setTimeout(() => {

        console.log(`folderPath:${folderPath}, is_public:${blog.is_public}`);

        const explorerLeaf = document.querySelector(
            `.nav-file-title[data-path="${folderPath}"]`
        );

        if (explorerLeaf) {
            // 이미 아이콘이 추가된 경우 중복 추가 방지
            const existingIcon = explorerLeaf.querySelector(".blog-icon");
            if (!existingIcon) {
                const blogIcon = document.createElement("span");
                blogIcon.className = "blog-icon";
                if (blog.is_public) {
                    blogIcon.textContent = "🌐"; // 블로그 아이콘 (이모지 또는 아이콘 라이브러리 활용 가능)
                }else {
                    blogIcon.textContent = "🔒"; // 블로그 아이콘 (이모지 또는 아이콘 라이브러리 활용 가능)
                }
                blogIcon.style.marginRight = "5px"; // 아이콘과 글씨 사이 여백 추가
                explorerLeaf.prepend(blogIcon); // 폴더명 앞에 아이콘 추가
            }else {
                // 아이콘이 이미 있는 경우 상태에 맞게 업데이트
                if ((existingIcon.textContent === "🌐" && !blog.is_public) || 
                    (existingIcon.textContent === "🔒" && blog.is_public)) {
                    // 현재 상태와 다른 경우에만 아이콘 업데이트
                    existingIcon.textContent = blog.is_public ? "🌐" : "🔒";
                }
            }
        }
    }, 500); // 500ms 딜레이 추가
}

// blog
export class BlogMetadata {
    id: number;
    tags: any;
    is_public: boolean;
    last_synced?: string;
    
    constructor(data: {
        id: number;
        tags: string;
        is_public: boolean;
        last_synced?: string;
    }) {
        this.id = data.id;

        // console.log(data.tags)

        if(data.tags) {
            this.tags = data.tags;
        }else {
            this.tags = [];
        }

        // this.tags = data.tags;
        this.is_public = data.is_public;
        this.last_synced = data.last_synced;
    }

    // MetadataCache에서 제공된 frontmatter 객체를 처리
    static fromFrontMatter(frontMatter: Record<string, any>): BlogMetadata {
        if (!frontMatter.id) {
            throw new Error("Front Matter must contain 'id'.");
        }
        
        return new BlogMetadata({
            id: frontMatter.id,
            tags: frontMatter.tags,
            is_public: frontMatter.is_public,
            last_synced: frontMatter.last_synced,
        });
    }

    getFrontMatter(): string {
        const frontMatter = `---\n` +
            `id: ${this.id}\n` +
            `tags: ${this.tags}\n` +
            `is_public: ${this.is_public}\n` +
            `last_synced: ${this.last_synced}\n` +
            `---\n`;
        return frontMatter;
    }
}

export async function saveBlogToMarkdown(app:App, blog: any, folderPath: string) {
    const sanitizedFileName = sanitizeFileName(blog.title);
    const filePath = `${folderPath}/${sanitizedFileName}.md`;
    
    try {
        const now = new Date().toISOString();
        
        // Front Matter 생성
        const metadata = new BlogMetadata(blog);
        metadata.last_synced = now;
        const frontMatter = metadata.getFrontMatter();

        // 페이지 내용 추가
        const content = frontMatter + (blog.content ?? "No content available.");

        // 파일 생성
        let file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.vault.modify(file, content);
        }else {
            file = await this.app.vault.create(filePath, content);
        }

        await addBlogIconToFile(filePath, blog);
        
        // 파일열기
        const leaf = this.app.workspace.getLeaf(false);
        await leaf.openFile(file);

    } catch (error) {
        console.error(`Failed to save blog: ${blog.title}`, error);
    }
    
}


export async function addBlogFrontMatterToFile(file: TFile) {
    const now = new Date().toISOString();
    // processFrontMatter를 사용하여 파일의 Front Matter 수정 또는 추가
    await this.app.fileManager.processFrontMatter(file, (frontMatter: Record<string, unknown>) => {
        if (!frontMatter) {
            // Front Matter가 없는 경우 새로 추가
            frontMatter = {};
        }

        // 필요한 값 추가 또는 업데이트
        frontMatter["id"] = frontMatter["id"] || -1;
        frontMatter["tags"] = '';
        frontMatter["is_public"] = true;
        frontMatter["last_synced"] = ''; // 동기화를 위해 비워둔다.
    });
}

export async function extractMetadataFromBlogFrontMatter(file: TFile): 
        Promise<BlogMetadata> {
    // Access the metadata cache
    const fileCache = this.app.metadataCache.getFileCache(file);

    // Check if frontMatter exists in the cache
    if (fileCache?.frontmatter) {
        return BlogMetadata.fromFrontMatter(fileCache.frontmatter);
    } else {
        throw new Error(`No Front Matter found in file: ${file.path}`);
    }
}