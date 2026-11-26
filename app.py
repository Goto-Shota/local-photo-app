import os
from fastapi import FastAPI, UploadFile, File, Form
import sqlite3
from datetime import datetime, timezone
from typing import List, Optional

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()

# 静的ファイル（HTMLや画像など）の配信設定
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/db/img", StaticFiles(directory="db/img"), name="img")
app.mount("/db/thumbs", StaticFiles(directory="db/thumbs"), name="thumbs")

DATA_DIR = os.path.join("/app", "db")
IMG_DIR = os.path.join(DATA_DIR, "img")
DB_PATH = os.path.join(DATA_DIR, "index.db")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(IMG_DIR, exist_ok=True)

# IP:PORT/にアクセスでindex.htmlを返す
@app.get("/")
def read_root():
    return FileResponse("static/index.html")

@app.get("/api/tags_list/")
def read_tags_list_from_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            tags.tag_name,
            count(tags.id) AS tag_count
        FROM tags
        LEFT JOIN image_tags
            ON tags.id = image_tags.tag_id
        GROUP BY
            tags.id
        ORDER BY tag_count DESC;
    """)

    rows = cursor.fetchall()
    conn.close()

    tags_list = [{"tag_name": row["tag_name"], "tag_count": row["tag_count"]} for row in rows]

    return {
        "tags_list":tags_list
    }

@app.get("/api/thumbs/")
def read_thumbs_from_db(
    # id or artist, ASC or DESCをアンダーバー区切りで指定
    sort: str = None,
    # カンマスペース区切り
    search: str = None,
    # AND or OR
    logical: str = "OR",
    limit: int = 10,
    offset: int = 0,
    archived: bool = True
):

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 検索ワードをカンマ区切りテキストから配列に変換
    search_word = []
    if search:
        for w in search.split(","):
            cleaned_w = w.strip()
            if cleaned_w.strip():
                search_word.append(f"%{cleaned_w}%")


    # 基本クエリの組み立て_PART1
    query = """
        WITH TargetIDs AS (
	"""
    params = []

    # 検索ワードがある場合
    if search_word:

        # AND検索の場合
        if logical == "AND":
            query +="""
                SELECT images.id
                FROM images
                LEFT JOIN image_tags ON images.id = image_tags.image_id
                LEFT JOIN tags ON image_tags.tag_id = tags.id
                WHERE tags.tag_name COLLATE NOCASE LIKE ? 
                    OR images.artist COLLATE NOCASE LIKE ?
                GROUP BY images.id 
            """
            params.extend([search_word[0], search_word[0]])

            if len(search_word) > 1:
                for word in search_word[1:]:
                    query += """
                        INTERSECT
                        SELECT images.id
                        FROM images
                        LEFT JOIN image_tags ON images.id = image_tags.image_id
                        LEFT JOIN tags ON image_tags.tag_id = tags.id
                        WHERE tags.tag_name COLLATE NOCASE LIKE ? 
                        OR images.artist COLLATE NOCASE LIKE ?
                        GROUP BY images.id 
                    """
                    params.extend([word, word])

        # OR検索の場合
        else:
            query += """
                SELECT images.id
                FROM images
                LEFT JOIN image_tags ON images.id = image_tags.image_id
                LEFT JOIN tags ON image_tags.tag_id = tags.id            
                WHERE (tags.tag_name COLLATE NOCASE LIKE ? OR images.artist COLLATE NOCASE LIKE ?)
            """
            params.extend([search_word[0], search_word[0]])

            if len(search_word) > 1:
                for word in search_word[1:]:
                    query += "OR (tags.tag_name COLLATE NOCASE LIKE ? OR images.artist COLLATE NOCASE LIKE ?) "
                    params.extend([word, word])
            query += "GROUP BY images.id "

    # 検索ワードがない場合
    else:
        query += """
            SELECT images.id
            FROM images
            JOIN image_tags ON images.id = image_tags.image_id
            JOIN tags ON image_tags.tag_id = tags.id         
            GROUP BY images.id
        """

    if not archived:
        query += """
            EXCEPT

            SELECT images.id
            FROM images
            JOIN image_tags ON images.id = image_tags.image_id
            JOIN tags ON image_tags.tag_id = tags.id
            WHERE tags.tag_name COLLATE NOCASE = 'archived' 
        """
    
    # 基本クエリの組み立て_PART2
    query += """
        )

        SELECT
            images.id,
            images.filename,
            images.artist,
            group_concat(tags.tag_name, ', ') AS tag_name
        FROM images
        JOIN image_tags
            ON images.id = image_tags.image_id
        JOIN tags
            ON image_tags.tag_id = tags.id
        WHERE images.id IN (SELECT id FROM TargetIDs)
        GROUP BY images.id 
	"""
    
    # ソート方式によってSQL文を変動
    match sort:
        case "id_ASC" | None:
            sort_column ="images.id"
            sort_type = "ASC"
        case "id_DESC":
            sort_column ="images.id"
            sort_type = "DESC"
        case "artist_ASC":
            sort_column ="images.artist"
            sort_type = "ASC"
        case "artist_DESC": 
            sort_column ="images.artist"
            sort_type = "DESC"
        case _:
            sort_column ="images.id"
            sort_type = "ASC"

    query += f"ORDER BY {sort_column} {sort_type}"

    # 総件数を引っ張る
    count_query = query + ";"
    cursor.execute(count_query, params)
    hits = cursor.fetchall()
    hit_cnt = len(hits)


    query += " LIMIT ? OFFSET ?;"
    params.extend([limit, offset])

    cursor.execute(query, params)

    rows = cursor.fetchall()
    conn.close()

    images_list = [{"id": row["id"], "filename": row["filename"], "artist": row["artist"], "tag_name": row["tag_name"]} for row in rows]
    return_cnt = len(images_list)

    return {
        "hit_cnt":hit_cnt,
        "img":images_list,
        "return_cnt":return_cnt
        }

@app.get("/api/filename/")
def read_filename_from_db(
    # 検索idの指定
    id: int = None
):

    if id is None: return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT
            images.id,
            images.filename,
            images.image_url,
            images.artist,
            images.artist_url,
            images.phash,
            images.registered_at,
            group_concat(tags.tag_name, ', ') AS tags
        FROM images
        LEFT JOIN image_tags
            ON images.id = image_tags.image_id
        LEFT JOIN tags
            ON image_tags.tag_id = tags.id
        WHERE images.id = ?
        GROUP BY images.id;
    """, (id,))

    row = cursor.fetchone()
    conn.close()

    if row is None: return

    tags_list = [t.strip() for t in row["tags"].split(", ") if t.strip()] if row["tags"] else []

    return {
        "filename":row["filename"],
        "image_url":row["image_url"],
        "filename":row["filename"],
        "artist":row["artist"],
        "artist_url":row["artist_url"],
        "phash":row["phash"],
        "registered_at":row["registered_at"],
        "tags":tags_list
        }