/// <reference types="@rbxts/testez/globals" />

// Basic enum test
enum Fruits {
	Apple,
	Orange,
	Pear,
	$,
}

// Numeric enum test
enum Breads {
	White = 5,
	Wheat,
	Pumpernickel,
	$,
}

// String enums
enum Soups {
	Tomato = "TOMATO",
	ChickenNoodle = "CHICKENNOODLE",
	Dumpling = "DUMPLING",
	$ = "DOLLARS",
}

enum EnumWithEscapedQuote {
	// prettier-ignore
	Quote = "\"",
}

const enum EnumWithEscapedQuoteConst {
	// prettier-ignore
	Quote = "\"",
}

const enum Person {
	Validark,
	Osyris,
	Evaera,
	Vorlias,
	DataBrain,
	$,
}

const enum Animal {
	Bear = "BEAR",
	Dog = "DOG",
	Snake = "SNAKE",
	$ = "SCARAB",
}

function getValue() {
	return 123;
}

enum WithInitializer {
	value = getValue(),
}

export = () => {
	it("should expose enums by number", () => {
		expect(Fruits[0]).to.equal("Apple");
		expect(Fruits.Orange).to.equal(1);
		expect(Fruits[2]).to.equal("Pear");
	});

	it("should support overriding indices", () => {
		expect(Breads[5]).to.equal("White");
		expect(Breads.Wheat).to.equal(6);
		expect(Breads[0]).never.to.be.ok();
	});

	it("should support for string indices", () => {
		expect(Soups.Tomato).to.equal("TOMATO");
		expect(Soups.ChickenNoodle).to.equal("CHICKENNOODLE");
		expect(Soups.Dumpling).to.equal("DUMPLING");
		expect(Soups.$).to.equal("DOLLARS");
	});

	it("should support numeric const enums", () => {
		expect(Person.Validark).to.equal(0);
		expect(Person.Osyris).to.equal(1);
		expect(Person.Evaera).to.equal(2);
		expect(Person.Vorlias).to.equal(3);
		expect(Person.DataBrain).to.equal(4);
		expect(Person.$).to.equal(5);
	});

	it("should support string const enums", () => {
		expect(Animal.Bear).to.equal("BEAR");
		expect(Animal.Dog).to.equal("DOG");
		expect(Animal.Snake).to.equal("SNAKE");
		expect(Animal.$).to.equal("SCARAB");
	});

	it("should support members with initializers", () => {
		expect(WithInitializer.value).to.equal(123);
	});

	it("should support hoisted enums", () => {
		expect(Animal2.Bear).to.equal("BEAR");
		expect(Animal2.Dog).to.equal("DOG");
		expect(Animal2.Snake).to.equal("SNAKE");
	});

	enum Animal2 {
		Bear = "BEAR",
		Dog = "DOG",
		Snake = "SNAKE",
	}

	it("should support enums with escaped quotes", () => {
		expect(EnumWithEscapedQuote.Quote).to.equal('"');
	});

	it("should support const enums with escaped quotes", () => {
		expect(EnumWithEscapedQuoteConst.Quote).to.equal('"');
	});

	it("should support computed keys", () => {
		const constKeyIndex = 4;
		let constKeyValue = 7;
		enum ConstComputedKey {
			// @ts-expect-error computed enum property key
			[constKeyIndex] = constKeyValue,
		}
		expect(ConstComputedKey[4]).to.equal(7);

		let computedKeyIndex = 1;
		enum ComputedKey {
			// @ts-expect-error computed enum property key
			[computedKeyIndex++] = computedKeyIndex,
		}
		expect(ComputedKey[1]).to.equal(2);
		expect(computedKeyIndex).to.equal(2);

		let computedValueIndex = 3;
		enum PrereqInValue {
			// @ts-expect-error computed enum property key
			[computedValueIndex] = (computedValueIndex = 6),
		}
		expect(PrereqInValue[3]).to.equal(6);
		expect(computedValueIndex).to.equal(6);

		let obj = { prop: 8 };
		enum PrereqValueReference {
			// @ts-expect-error computed enum property key
			[obj.prop] = (obj.prop = 6),
		}
		expect(PrereqValueReference[8]).to.equal(6);
		expect(obj.prop).to.equal(6);
	});
};
