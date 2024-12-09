import { Modal, TAbstractFile, TFile, TFolder, normalizePath } from "obsidian";

export function sanitizeFileName(fileName: string): string {
    // Obsidian의 normalizePath로 경로를 표준화하고 불필요한 문자를 제거
    return normalizePath(fileName);
}

export function removeFrontMatter(content: string): string {
    // Front Matter가 있는지 확인
    const frontMatterMatch = content.match(/^---[\s\S]*?---\n/);
    if (frontMatterMatch) {
        return content.replace(frontMatterMatch[0], "").trim(); // Front Matter 제거
    }
    return content.trim(); // Front Matter가 없으면 그대로 반환
}

export function extractTitleFromFilePath(filePath: string): string {
    const parts = filePath.split("/");
    const fileName = parts[parts.length - 1];
    return fileName.replace(".md", ""); // 확장자 제거
}

export function getFileModifiedTime(file: TFile): Date {
    return new Date(file.stat.mtime);
}

export function ensureLineBreaks(content: string): string {
    return content.replace(/(.+)(\n|$)/g, (_, line, lineBreak) => {
        return line.trimEnd() + "  " + lineBreak; // 각 줄 끝에 두 개의 공백 추가
    });
}

export async function readTopLevelMetadata(fileOrFolder: TAbstractFile): Promise<Record<string, string | number> | null> {
    let current: TAbstractFile | null = fileOrFolder;

    while (current && current.parent) {
        if (current instanceof TFolder) {
            const metadataFilePath = `${current.path}/metadata.md`;
            const metadataFile = this.app.vault.getAbstractFileByPath(metadataFilePath);

            if (metadataFile instanceof TFile) {
                // MetadataCache에서 Front Matter 데이터 가져오기
                const fileCache = this.app.metadataCache.getFileCache(metadataFile);

                if (fileCache?.frontmatter) {
                    const metadata: Record<string, string | number> = {};

                    // frontmatter 객체를 순회하며 메타데이터 추출
                    for (const [key, value] of Object.entries(fileCache.frontmatter)) {
                        // 값이 string 또는 number인지 확인
                        if (typeof value === "string" || typeof value === "number") {
                            metadata[key] = value;
                        }
                    }

                    return metadata; // 메타데이터 반환
                }
            }
        }
        current = current.parent;
    }

    // 메타데이터를 찾을 수 없으면 null 반환
    return null;
}


export async function deleteFolderContents(folder: TFolder): Promise<void> {
    const abstractFiles = [...folder.children]; // 자식 파일 및 폴더 가져오기

    for (const file of abstractFiles) {
        if (file instanceof TFile && file.name === "metadata.md") {
            // metadata.md는 삭제하지 않음
            continue;
        }
        await this.app.fileManager.trashFile(file);
    }
}

// 폴더가 없으면 생성하는 함수
export async function ensureFolderExists(folderPath: string): Promise<void> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
        await this.app.vault.createFolder(folderPath);
    }
}


export function extractEmbeddedImages(file: TFile): TFile[] {
    const fileCache = this.app.metadataCache.getFileCache(file);

    if (!fileCache?.embeds) {
        return [];
    }

    const imageFiles: TFile[] = [];
    for (const embed of fileCache.embeds) {
        const decodedPath = decodeURIComponent(embed.link);
        const imageFile = this.app.metadataCache.getFirstLinkpathDest(decodedPath, file.path);

        if (imageFile instanceof TFile && imageFile.extension.match(/jpg|jpeg|png|gif/)) {
            imageFiles.push(imageFile);
        }
    }
    return imageFiles;
}


export async function showConfirmationDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        const modal = new Modal(this.app);

        // Modal UI 구성
        modal.contentEl.createEl("h2", { text: "확인 필요" });

        // 줄바꿈 처리
        const lines = message.split("\n");
        lines.forEach((line) => {
            modal.contentEl.createEl("p", { text: line });
        });

        // 확인 버튼
        const confirmButton = modal.contentEl.createEl("button", { text: "확인" });
        confirmButton.classList.add("dialog-confirm-button"); // 클래스 추가
        confirmButton.addEventListener("click", () => {
            modal.close();
            resolve(true); // 사용자가 확인을 선택
        });

        // 취소 버튼
        const cancelButton = modal.contentEl.createEl("button", { text: "취소" });
        cancelButton.classList.add("dialog-cancel-button"); // 클래스 추가
        cancelButton.addEventListener("click", () => {
            modal.close();
            resolve(false); // 사용자가 취소를 선택
        });
        
        modal.open();
    });
}
