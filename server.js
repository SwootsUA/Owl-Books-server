import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import path from 'path';

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

// GOOGLE OAUTH2 Section (start)

function isLoggedIn(req, res, next) {
  req.user ? next() : res.sendStatus(401);
}

app.use(session({ secret: 'cats', resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

// Redundant
// app.get('/auth', (req, res) => {
//   res.send('<a href="/auth/google">Authenticate with Google</a>');
// });

app.get('/auth/google',
  passport.authenticate('google', { scope: [ 'email', 'profile' ] }
));

app.get( '/auth/google/callback',
  passport.authenticate('google', {
    successRedirect: '/protected',
    failureRedirect: '/auth/google/failure'
  })
);

app.get('/protected', isLoggedIn, (req, res) => {
  let info = '';
  info += 'id: ' + req.user.id + '\n';
  info += 'email: ' + req.user.email + '\n';
  info += 'name: ' + req.user.given_name + '\n';
  info += 'surname: ' + req.user.family_name + '\n';
  createNewUser(req, res);
  res.send(info);
});

app.get('/logout', (req, res) => {
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
  res.send('Failed to authenticate..');
});

async function createNewUser(req, res) {
  (await connection).query(`SELECT CASE WHEN EXISTS (SELECT 1 FROM users WHERE google_id = '${req.user.id}') THEN 'true' ELSE 'false' END AS result;`)
  .then(async (value) => {
    // if user is not in DB, create one
    if(value[0][0].result == 'false') {
      try{
        (await connection).beginTransaction();
        (await connection).query(`INSERT INTO \`owl-books\`.\`users\` (\`google_id\`, \`name\`, \`surname\`, \`email\`) VALUES ('${req.user.id}', '${req.user.given_name}', '${req.user.family_name}', '${req.user.email}');`)
        .then((await connection).commit());
      } catch (error) {
        (await connection).rollback();
        console.log(`create-new-user: error: ${error}`);
        res.status(500).send('Error retrieving data from database');
      }
    } 
  })
  return;
}

// GOOGLE OAUTH2 Section (end)

app.use(cors());

app.get(
  '/image', 
  function(req, res) {
    const { imgName } = req.query;
    //console.log(`image: imgName: ${imgName}`)
    res.sendFile(imgName, { root: path.join(__dirname, 'images') });
  }
);

app.use(
  '/add-order',
  async (req, res) => {
    try {
      // test link
      // http://localhost:2210/add-order?name=John&surname=Doe&phone_number=123456&email=johndoe@email.com&region_id=1&city=New+York&NovaPoshta=123456&description=This+is+a+test+order&content=[{"book_id":1,"amount":2}]
      const { name, surname, phone_number, email, region_id, city, NovaPoshta, description, content } = req.query;
      
      const parsedContent = JSON.parse(content);
      const bookIds = parsedContent.map(item => item.id);
      const amounts = parsedContent.map(item => item.quantity);
      var orderId;

      //console.log(`add-order: values: ${name, surname, phone_number, email, region_id, city, NovaPoshta, description, parsedContent}`);

      (await connection).beginTransaction();
      
      (await connection).query(`INSERT INTO order_info (\`name\`, surname, phone_number, email, region_id, city, NovaPoshta, \`description\`) VALUES ('${name}', '${surname}', '${phone_number}', '${email}', ${region_id}, '${city}', '${NovaPoshta}', '${description}')`)
      .then( async (value) => {
        orderId = value[0].insertId;

        if(bookIds.length == 1){
          (await connection).query(`INSERT INTO order_content (order_id, book_id, amount) VALUES (${orderId}, ${bookIds[0]}, ${amounts[0]})`)
          .catch(async error => {
            console.log(`add-order: error: ${error}`);
            (await connection).rollback();
          });
        } else {
          for (let i = 0; i < content.length; i++) {
            (await connection).query(`INSERT INTO order_content (order_id, book_id, amount) VALUES (${orderId}, ${bookIds[i]}, ${amounts[i]})`)
            .catch(async error => {
              console.log(`add-order: error: ${error}`);
              (await connection).rollback();
            });
          }
        }

        (await connection).commit();
        res.status(201).json({ orderId });
      });
    } catch (error) {
      (await connection).rollback();
      console.log(`add-order: error: ${error}`);
      res.status(500).send('Error retrieving data from database');
    }
  }
);

app.use(
  '/cart',
  async (req, res) => {
    try {
      const { ids } = req.query;

      //console.log(`cart: ids: ${ids}`);

      let search = (typeof ids === 'undefined' || ids == '') ? "-1" : ids;
      (await connection).query(`
        SELECT books.book_id, books.image, books.\`name\`, books.price, (
            SELECT authors.\`name\` 
            FROM authors 
            JOIN books_authors ON authors.author_id = books_authors.author_id 
            WHERE books_authors.book_id = books.book_id LIMIT 1) AS author_name 
        FROM books 
        WHERE books.book_id IN (${search});`)
      .then(async (result) => {
        res.send(result[0]);
      });
    } catch (error) {
      console.log(`cart: error: ${error}`);
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
        //console.log(`item quantity: id: ${id} response: 404 Book not found`);
        res.status(404).send('404 Book not found');
        return;
      }

      (await connection).query(`SELECT quantity FROM books WHERE book_id = ${parseInt(id)};`)
      .then( (quantity) => {
        //console.log(`item quantity: id: ${id} response: ${JSON.stringify(quantity[0][0])}`);
        res.send(quantity[0][0]);
      })

    } catch (error) {
      console.log(`item quantity: id: ${id} error: ${error}`);
      res.status(500).send('Error retrieving data from database');
    }
  }
)


app.use(
  '/item',
  async (req, res) => {
    try {
      const { id } = req.query;
      //console.log(`item: id: ${id}`);
      if(isNaN(id)) {
        //console.log(`item: response: 404 Book not found`);
        res.status(404).send('404 Book not found');
        return;
      }
      var info;
      var genres;
      var authors;
      (await connection).query(`SELECT book_id, quantity, ISBN, page_amount, books.\`name\`, publisher.\`name\` AS pub_name, price, image, \`description\` FROM books JOIN publisher ON books.publisher_id = publisher.publisher_id WHERE book_id = ${parseInt(id)};`)
      .then(async (inf) => {
        info = inf[0][0];
        (await connection).query(`SELECT genres.\`name\` FROM books_genres JOIN genres ON genres.genre_id = books_genres.genre_id WHERE book_id = ${parseInt(id)};`)
        .then(async (gen) => {
          genres = gen[0];
          (await connection).query(`SELECT authors.\`name\` FROM books_authors JOIN authors ON authors.author_id = books_authors.author_id WHERE book_id = ${parseInt(id)};`)
          .then(async(aut) => {
            authors = aut[0];
            res.send({info, genres, authors});
          })
        })
      })
    } catch (error) {
      console.log(error);
      res.status(500).send('Error retrieving data from database');
    }
  }
);

app.use(
  '/search',
  async (req, res) => {
    try {
      const { name } = req.query; 
      const search = (typeof name === 'undefined') ? "" : name;

      //console.log(`search: name: ${name}`);

      (await connection).query(`SELECT book_id, quantity, \`name\`, price, image FROM books WHERE \`name\` LIKE '%${search}%';`)
      .then(async (result) => {
        res.send(result[0]);
      });
    } catch (error) {
      console.log(error);
      res.status(500).send('Error retrieving data from database');
    }  
  }
);

app.listen(port, function() {
  console.log('Server is up and running!')
});
