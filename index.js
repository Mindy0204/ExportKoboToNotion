require("dotenv").config();
const { NOTION_TOKEN, NOTION_DATABASE_ID } = process.env;
const { Client } = require("@notionhq/client");
const notion = new Client({ auth: NOTION_TOKEN });
const db = require("better-sqlite3")("highlights.sqlite");

async function exportHighlights() {
  const getBookListQuery =
    "SELECT DISTINCT content.ContentId, content.Title, content.Attribution AS Author " +
    "FROM Bookmark INNER JOIN content " +
    "ON Bookmark.VolumeID = content.ContentID " +
    "ORDER BY content.Title";
  const bookList = db.prepare(getBookListQuery).all();
  // console.log(bookList)

  /** 
   * Query pages of database and check if the book was already been create
   * */
  const map = new Map()
  const pageList = await notion.databases.query({
    database_id: NOTION_DATABASE_ID
  });

  // Use the concept of LeetCode: Intersection of Two Arrays
  pageList.results.forEach(item => {
    if (item.properties.Name.title[0] != null) {
      map.set(item.properties.Name.title[0].plain_text, false)
    } 
  });
  bookList.forEach(item => {
    if (map.get(item.Title) != null) {
      map.set(item.Title, true)
    } else {
      map.set(item.Title, false)
    }
  });
  // console.log(map)
  
  for (let [key, value] of map) {
    if (value != true) {
      try {
      /**
       * Create Notion page in database
       * */
      await notion.pages.create({
        "parent": { database_id: NOTION_DATABASE_ID },
        "properties": {
          "Name": { "title": [ { "text": { "content": key } } ] },
          "Title": { "rich_text": [ { "text": { "content": key } } ] }
        }});

      } catch (error) {
        console.log(`Error with ${key}: `, error);
      }
    }
  }


  for (book of bookList) {
    try {

      let title = book.Title;

      // Check Notion database for the book
      const response = await notion.databases.query({
        database_id: NOTION_DATABASE_ID,
        filter: {
          and: [
            { property: "Title", text: { contains: title } },
            { property: "Highlights", checkbox: { equals: false } },
          ],
        },
      });

      // Use the results to determine status of the book
      var valid = false;
      if (response.results.length === 1) {
        valid = true;
      } else if (response.results.length > 1) {
        console.log(`${title} matched multiple items.`);
      } else {
        console.log(`${title} was skipped.`);
      }

      if (valid) {
        const pageId = response.results[0].id;
        var blocks = [];

        // Retrieves highlights for the book
        const getHighlightsQuery =
          "SELECT Bookmark.Text FROM Bookmark INNER JOIN content ON Bookmark.VolumeID = content.ContentID " +
          "WHERE content.ContentID = ? " +
          "ORDER BY content.DateCreated DESC";
        const highlightsList = db
          .prepare(getHighlightsQuery)
          .all(book.ContentID);

        // Starts with a block for the heading
        blocks.push({
          object: "block",
          type: "heading_2",
          heading_2: {
            text: [{ type: "text", text: { content: "Highlights" } }],
          },
        });

        // Generates a text block for each highlight
        for (highlight of highlightsList) {
          if (highlight.Text !== null) {
            blocks.push({
              object: "block",
              type: "bulleted_list_item",
              bulleted_list_item: {
                text: [{ type: "text", text: { content: highlight.Text } }],
              },
            });
          }
        }

        // Appends the blocks to the book page
        await notion.blocks.children.append({
          block_id: pageId,
          children: blocks,
        });

        // Updates the status of the book page
        await notion.pages.update({
          page_id: pageId,
          properties: { Highlights: { checkbox: true } },
        });

        console.log(`Uploaded highlights for ${title}.`);
      }
    } catch (error) {
      console.log(`Error with ${book.Title}: `, error);
    }
  }
}

exportHighlights();
