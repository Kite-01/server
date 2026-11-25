UPDATE "kite_token" SET "name" = split_part("name", ':', 1) WHERE "name" ~ '^[A-Za-z0-9]{1,12}:G[A-Z2-7]{55}$';
