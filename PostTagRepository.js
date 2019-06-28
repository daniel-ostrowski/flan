class PostTagRepository {
    constructor(dao) {
        this.dao = dao;
    }

    getByPostID(postID) {
        return this.dao.get(`SELECT * FROM PostTags WHERE PostID = ?`, [postID]);
    }

    getByTagID(tagID) {
        return this.dao.get(`SELECT * FROM PostTags WHERE TagID = ?`, [tagID]);
    }
}

module.exports = PostTagRepository;