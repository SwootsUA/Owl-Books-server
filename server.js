// to allow the current PowerShell session to execute scripts write: `Set-ExecutionPolicy RemoteSigned -Scope Process`
// and then to start the server write: `nodemon index.js`

import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

const bodyParser = require('body-parser');
const session = require('express-session');
const passport = require('passport');

const app = express();
const port = 2210;

var connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'owl-books'
});

app.use(cors({origin: ['http://localhost:5500', 'http://127.0.0.1:5500']}));
app.use(bodyParser.json());

// GOOGLE OAUTH2 Section (start)

app.use(session({ 
  secret: 'cats', 
  resave: false, 
  saveUninitialized: true 
}));

app.use(passport.initialize());
app.use(passport.session());

function isLoggedIn(req, res, next) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  req.user ? next() : res.status(401).send('<script>window.location.href = "http://localhost:5500/user.html" </script>');
}

app.get('/auth/google',
  passport.authenticate('google', { scope: [ 'email', 'profile' ] }
));

app.get('/auth/google/callback',
  passport.authenticate('google', {
    successRedirect: '/close-window',
    failureRedirect: '/auth/google/failure'
  })
);

app.get('/save-user', isLoggedIn, async (req, res) => {
  try {
    const google_id = req.user.sub;
    var query = req.query;
    var fields;
    fields = JSON.parse(query.fields);

    var fieldsQuery = '';
    var values = [];

    for (var field in fields) {
      fieldsQuery += `${field}=?,`;
      values.push(fields[field]);
    }

    fieldsQuery = fieldsQuery.slice(0, -1);

    var saveUserQuery = `UPDATE users SET ${fieldsQuery} WHERE google_id=?;`;

    values.push(google_id);

    console.log(saveUserQuery);
    console.log(values);

    try {
      await (await connection).query(saveUserQuery, values);
      res.status(200).send('user saved');
      console.log('user saved');
    } catch (error) {
      res.status(500).send('internal server error');
      console.error('user NOT saved: ' + error);
    }
  } catch (error) {
    console.error(`save-user error: ${error}`)
    res.status(401).send('user not saved (Unauthorized)');
  }
});

app.get('/close-window', (req, res) => {
  res.send('<script>window.location.href = "http://localhost:5500/user.html" </script>');
})

app.get('/logout', (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  req.logout(err => {
      if (err) {
          return next(err);
      }
      req.session.destroy(() => {
          res.send('Goodbye!');
      });
  });
});

app.get('/auth/google/failure', (req, res) => {
  res.send('failed to authorize');
});

app.get('/protected', isLoggedIn, async (req, res) => {
  try {
    let info = await createNewUser(req);
    res.status(200).json(info);
  } catch (error) {
    res.status(500).send('Error retrieving data from database');
  }
});

async function createNewUser(req, res) {
  try {
    const google_id = req.user.id;
    const name = req.user.given_name;
    const surname = req.user.family_name;
    const email = req.user.email;

    var createNewUserQuery = `SELECT CASE WHEN EXISTS (SELECT 1 FROM users WHERE google_id = ?) THEN 'true' ELSE 'false' END AS result;`;
    const userExistsResult = await (await connection).query(createNewUserQuery, [google_id]);

    // if user is not in DB, create one
    if (userExistsResult && userExistsResult[0] && userExistsResult[0][0].result == 'false') {
      try {
        await (await connection).beginTransaction();
        createNewUserQuery = `INSERT INTO \`owl-books\`.\`users\` (\`google_id\`, \`name\`, \`surname\`, \`email\`) VALUES (?, ?, ?, ?);`;
        await (await connection).query(createNewUserQuery, [google_id, name, surname, email]);
        (await connection).commit();
      } catch (error) {
        (await connection).rollback();
        console.error(`create-new-user: error: ${error}`);
        throw new Error('Error creating new user');
      }
    }

    createNewUserQuery = `SELECT * FROM users WHERE google_id = ?;`
    const userResult = await (await connection).query(createNewUserQuery, [google_id]);
    const dbUser = userResult[0][0];

    const info = {
      google_id: google_id,
      picture: req.user.picture,
      name: dbUser.name,
      surname: dbUser.surname,
      email: dbUser.email,
      phone_number: dbUser.phone_number,
      region_id: dbUser.region_id,
      city: dbUser.city
    };

    console.log(info);
    return info;
  } catch (error) {
    console.error(`create-new-user: error: ${error}`);
    throw new Error('Error retrieving data from database');
  }
}

// GOOGLE OAUTH2 Section (end)

async function getFile(req, res, google_id, book_id, folder_path) {
  try {
  var fileQuery;

  if (!book_id) {
    return res.status(400).send('Missing required query parameters');
  }

    fileQuery = `
    SELECT EXISTS (
      SELECT 1
        FROM order_info 
        WHERE order_id IN (
          SELECT order_id 
          FROM order_content 
          WHERE book_id = ?
        ) 
        AND user_id = (
          SELECT user_id 
          FROM users 
          WHERE google_id = ?
        ) 
        AND paid_status = 'Yes'
    ) AS isNotNULL;`;

    const isOwned = await (await connection).query(fileQuery, [book_id, google_id]);
    if(isOwned[0][0].isNotNULL != 1) {
      return res.status(401).send("You don't own this book");
    } 

    fileQuery = `SELECT file_name FROM books WHERE book_id = ?;`
    
    var file_name = await (await connection).query(fileQuery, [book_id])
    file_name = file_name[0][0].file_name;
   
    const filePath = path.join(__dirname, `${folder_path}${file_name}`);

    if(fs.existsSync(filePath)) {
      res.sendFile(filePath); 
    } else {
      return res.status(404).send('Book not found');
    }
  }
  catch (error) {
    console.error("getFile error: " + error);
    return res.status(500).send('Server error');
  }
}

app.get('/mp3', isLoggedIn, async (req, res) => {
  const google_id = req.user.sub;
  const { book_id } = req.query;

  getFile(req, res, google_id, book_id, './audio_books/')
});

app.get('/pdf', isLoggedIn, async (req, res) => {
  const google_id = req.user.sub;
  const { book_id } = req.query;

  getFile(req, res, google_id, book_id, './electronic_books/')
});

app.get(
  '/books', isLoggedIn,
  async function (req, res) {
    const google_id = req.user.sub;
    const { format_id } = req.query;
    var booksQuery;
    
    if (!format_id) {
      return res.status(400).send('Missing required query parameters');
    }

    try {
      booksQuery = `SELECT book_id FROM books 
      WHERE format_id = ? 
      AND book_id IN (
        SELECT book_id FROM order_content 
        WHERE order_id IN (
          SELECT order_id FROM order_info 
          WHERE user_id = (
            SELECT user_id FROM users 
            WHERE google_id = ?
          ) AND paid_status = 'Yes'
        )
      );`

      const bookIds = await (await connection).query(booksQuery, [format_id, google_id]);

      res.send(bookIds[0]);
    } catch (error) {
      console.error(`books: error: ${error}`);
      res.status(500).send('Error retrieving data from database');
    }
  }
);

app.get(
  '/image', 
  function(req, res) {
    const { imgName } = req.query;
    res.sendFile(imgName, { root: path.join(__dirname, 'images') });
  }
);

app.use(
  '/add-order',
  async (req, res) => {
    try {
      const { 
        google_id = 0, 
        name, 
        surname, 
        phone_number = null, 
        email, 
        region_id = 0, 
        city = null, 
        NovaPoshta = null, 
        pickUpDate,
        description = '', 
        content 
      } = req.query;

      console.log(req.query);
      console.log(pickUpDate);

      const parsedContent = JSON.parse(content);
      const bookIds = parsedContent.map(item => item.id);
      const amounts = parsedContent.map(item => item.quantity);
      let orderId;

      const [user] = await (await connection).query(`SELECT user_id FROM users WHERE google_id = ?;`, [google_id]);
      let user_id = user.length > 0 ? user[0].user_id : undefined;

      // Construct the base query
      let addOrderQuery = `
        INSERT INTO order_info (\`name\`, surname, phone_number, email, region_id, city, NovaPoshta, pickUpDate, \`description\`${user_id !== undefined ? ', user_id' : ''}) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?${user_id !== undefined ? ', ?' : ''});
      `;

      // Query parameters
      let queryParams = [name, surname, phone_number, email, region_id, city, NovaPoshta, pickUpDate, description];
      if (user_id !== undefined) {
        queryParams.push(user_id);
      }

      // Begin transaction
      await (await connection).beginTransaction();

      // Execute the query
      const [result] = await (await connection).query(addOrderQuery, queryParams);
      orderId = result.insertId;

      // Insert into order_content table
      const orderContentQueries = bookIds.map(async (book_id, i) => (
        (await connection).query(`INSERT INTO order_content (order_id, book_id, amount) VALUES (?, ?, ?);`, [orderId, book_id, amounts[i]])
      ));

      await Promise.all(orderContentQueries);

      // Commit transaction
      await (await connection).commit();
      res.status(201).json({ orderId });
      
    } catch (error) {
      await (await connection).rollback();
      console.error(`add-order: error: ${error}`);
      res.status(500).send('Error processing your request');
    }
  }
);


app.use(
  '/cart',
  async (req, res) => {
    try {
      const { ids } = req.query;
      var cartQuery;
      
      let search = (typeof ids === 'undefined' || ids == '') ? "-1" : ids;
      cartQuery = `SELECT books.format_id, books.book_id, books.image, books.\`name\`, books.price, (
          SELECT authors.\`name\` 
          FROM authors 
          JOIN books_authors ON authors.author_id = books_authors.author_id 
          WHERE books_authors.book_id = books.book_id LIMIT 1) AS author_name 
      FROM books 
      WHERE books.book_id IN (?);`;

      console.log(search);

      (await connection).query(cartQuery, [search])
      .then((result) => {
        res.send(result[0]);
      });
    } catch (error) {
      console.error(`cart: error: ${error}`);
      res.status(500).send('Error retrieving data from database');
    }
  }
);

app.use(
  '/item-quantity',
  async (req, res) => {
    try {
      const { id } = req.query;
      if(isNaN(id)) {
        res.status(404).send('404 Book not found');
        return;
      }

      var itemQuantityQuery = `SELECT quantity FROM books WHERE book_id = ?;`;
      (await connection).query(itemQuantityQuery, [id])
      .then( (quantity) => {
        res.send(quantity[0][0]);
      })

    } catch (error) {
      console.error(`item quantity: id: ${id} error: ${error}`);
      res.status(500).send('Error retrieving data from database');
    }
  }
)


app.use(
  '/item',
  async (req, res) => {
    try {
      const { id } = req.query;
      if(isNaN(id)) {
        res.status(404).send('404 Book not found');
        return;
      }

      var info;
      var genres;
      var authors;
      var itemQuery;

      itemQuery = `
      SELECT book_id, quantity, ISBN, page_amount, books.\`name\`, publisher.\`name\` AS pub_name, books.publisher_id AS pub_id, price, image, \`description\`, format_id
      FROM books 
      JOIN publisher 
      ON books.publisher_id = publisher.publisher_id 
      WHERE book_id = ?
      AND hidden = 'No';`;

      (await connection).query(itemQuery, [id])
      .then(async (inf) => {
        info = inf[0][0];

        itemQuery = `
        SELECT genres.\`name\`, genres.genre_id
        FROM books_genres 
        JOIN genres 
        ON genres.genre_id = books_genres.genre_id 
        WHERE book_id = ?;`;

        (await connection).query(itemQuery, [id])
        .then(async (gen) => {
          genres = gen[0];

          itemQuery = `
          SELECT authors.\`name\`, authors.author_id
          FROM books_authors 
          JOIN authors 
          ON authors.author_id = books_authors.author_id 
          WHERE book_id = ?;`;

          (await connection).query(itemQuery, [id])
          .then(async(aut) => {
            authors = aut[0];
            res.send({info, genres, authors});
          })
        })
      })
    } catch (error) {
      console.error('/item error: ' + error);
      res.status(500).send('Error retrieving data from database');
    }
  }
);

app.use(
  '/search',
  async (req, res) => {
    try {
      const { 
        name, 
        book_type,
        genre, 
        author, 
        publisher, 
        orderby 
      } = req.query; 

      console.log(req.query);

      var params = [];

      let query = `
        SELECT DISTINCT
            b.book_id, 
            b.quantity, 
            b.\`name\`, 
            b.price, 
            b.image,
            b.hidden
        FROM 
            books b
        LEFT JOIN
            books_authors ba ON b.book_id = ba.book_id
        LEFT JOIN
            books_genres bg ON b.book_id = bg.book_id
        WHERE 
            b.hidden = 'No'
      `;

      console.log(book_type);
      if(book_type) {
        query += ` AND b.format_id = ?`;
        params.push(book_type);
      }

      if (name) {
        query += ` AND b.\`name\` LIKE '%?%'`;
        params.push(name);
      }

      if (publisher) {
        query += ` AND b.publisher_id = ?`;
        params.push(publisher);
      }

      if (author) {
        query += ` AND ba.author_id = ?`;
        params.push(author);
      }

      if (genre) {
        query += ` AND bg.genre_id = ?`;
        params.push(genre);
      }

      if (orderby === 'price_asc') {
        query += ` ORDER BY b.price ASC`;
      } else if (orderby === 'price_des') {
        query += ` ORDER BY b.price DESC`;
      } else if (orderby === 'alphab_asc') {
        query += ` ORDER BY b.\`name\` ASC`;
      } else if (orderby === 'alphab_des') {
        query += ` ORDER BY b.\`name\` DESC`;
      }

      console.log(query);

      (await connection).query(query, params)
      .then((result) => {
        res.send(result[0]);
      })
      .catch((error) => {
        console.error(error);
        res.status(500).send('Error retrieving data from database');
      });
    } catch (error) {
      console.error(error);
      res.status(500).send('Error retrieving data from database');
    }  
  }
);

app.get('/params',
  async (req, res) => {
    try {
      const {  
        book_type = null,
        genre = null, 
        author = null, 
        publisher = null
      } = req.query;
       
      var paramsQuery = `
      SELECT 
        (SELECT \`name\` FROM books_formats WHERE format_id = ?) AS book_format,
        (SELECT \`name\` FROM genres WHERE genre_id = ?) AS genre_name,
        (SELECT \`name\` FROM authors WHERE author_id = ?) AS author_name,
        (SELECT \`name\` FROM publisher WHERE publisher_id = ?) AS publisher_name;
      `;

      (await connection).query(paramsQuery, [book_type, genre, author, publisher])
      .then((result) => {
        console.log(result[0][0])
        res.send(result[0][0]);
      })
      .catch((error) => {
        console.error("/params error: " + error);
        res.status(500).send('Error retrieving data from database');
      });
    } catch (error) {
      res.status(500).send('Error retrieving data from database');
    }
  }
)

app.listen(port, function() {
  console.log('Server is up and running!');
});
